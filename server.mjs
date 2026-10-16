import http from "node:http";
import { homedir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readClaudeUsage } from "./claude-control.mjs";
import { createClaudeUsageMonitor } from "./claude-cache.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = __dirname;
const port = Number(process.env.PORT || 5173);
const homeDir = homedir();
const usageCachePath = path.join(homeDir, ".t3", "userdata", "usage-scan-cache.json");
const usageRatesPath = path.join(homeDir, ".t3", "userdata", "usage-model-rates.json");
const accountSnapshotCachePath = path.join(homeDir, ".t3", "userdata", "usage-pulse-account-cache.json");
const claudeUsageCachePath = path.join(homeDir, ".t3", "userdata", "usage-pulse-claude-usage-cache.json");
const commandCodeProjectsPath = path.join(homeDir, ".commandcode", "projects");
const lifetimeLookbackDays = 3650;

// Both desktop surfaces (main window and menu-bar popover) poll this server
// independently, so every expensive source is memoised for a little less than
// one poll interval and concurrent requests share a single in-flight pass.
const snapshotTtlMs = Number(process.env.PULSE_SNAPSHOT_TTL_MS ?? 4000);
const codexAccountsTtlMs = Number(process.env.PULSE_CODEX_TTL_MS ?? 10000);
const openCodeTtlMs = Number(process.env.PULSE_OPENCODE_TTL_MS ?? 60000);

// The local LiteLLM snapshot can lag a newly released model. Keep the current
// Astra rates available as a small safety net, while allowing a newer local
// rate table to override them when it catches up.
const builtInModelRates = new Map([
  ["gpt-6-astra", {
    input: 0.00001,
    output: 0.00005,
    cacheRead: 0.000001,
    cacheCreation: 0.0000125
  }]
]);

const providerBlueprints = [
  { id: "codex", name: "Codex", shortName: "Codex", color: "#e5e7eb", cost: 1928.4, tokens: 8_330_000_000, source: "Local session cache" },
  { id: "claude", name: "Claude Code", shortName: "Claude", color: "#ff825f", cost: 862.75, tokens: 1_170_000_000, source: "Local session cache" },
  { id: "commandcode", name: "Command Code", shortName: "Command", color: "#b99cff", cost: 14.9, tokens: 84_300_000, source: "Local transcripts" },
  { id: "cursor", name: "Cursor", shortName: "Cursor", color: "#79a7ff", cost: 8.31, tokens: 61_800_000, source: "Telemetry unavailable" },
  { id: "opencode", name: "OpenCode", shortName: "OpenCode", color: "#64dcc4", cost: 4.78, tokens: 46_200_000, source: "Local stats" }
];

const codexAccountBlueprints = [
  { id: "codex-main", profile: ".codex", home: path.join(homeDir, ".codex"), fallbackPlan: null },
  { id: "codex-alt", profile: ".codex-alt", home: path.join(homeDir, ".codex_alt"), fallbackPlan: null },
  { id: "codex-alt2", profile: ".codex-alt2", home: path.join(homeDir, ".codex_alt2"), fallbackPlan: null }
];
const codexAccountSnapshotCache = new Map();
let accountSnapshotCacheLoaded = false;

async function ensureAccountSnapshotCache() {
  if (accountSnapshotCacheLoaded) return;
  const stored = await readJson(accountSnapshotCachePath);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [accountId, snapshot] of Object.entries(stored?.accounts || {})) {
    if (snapshot && Number(snapshot.updatedAt) >= cutoff) codexAccountSnapshotCache.set(accountId, snapshot);
  }
  accountSnapshotCacheLoaded = true;
}

async function persistAccountSnapshotCache() {
  const temporaryPath = `${accountSnapshotCachePath}.${process.pid}.${Date.now()}.tmp`;
  const document = JSON.stringify({ version: 1, accounts: Object.fromEntries(codexAccountSnapshotCache) });
  await fs.mkdir(path.dirname(accountSnapshotCachePath), { recursive: true }).catch(() => {});
  await fs.writeFile(temporaryPath, document, "utf8").then(() => fs.rename(temporaryPath, accountSnapshotCachePath)).catch(() => {});
}

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then(JSON.parse).catch(() => null);
}

// The scanner rewrites these files as usage arrives. Checking their identity
// before reusing parsed data avoids repeatedly decoding several megabytes on
// every range change, without delaying newly written telemetry.
function fileSignature(stats) {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function createJsonFileReader({ stat = fs.stat, readFile = fs.readFile, maxEntries = 4 } = {}) {
  const entries = new Map();
  return async (filePath) => {
    try {
      const stats = await stat(filePath);
      const signature = fileSignature(stats);
      const cached = entries.get(filePath);
      if (cached?.signature === signature) return await cached.value;
      const value = readFile(filePath, "utf8").then(JSON.parse);
      const entry = { signature, value };
      entries.delete(filePath);
      entries.set(filePath, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      try {
        const result = await value;
        if (fileSignature(await stat(filePath)) !== signature && entries.get(filePath) === entry) entries.delete(filePath);
        return result;
      } catch {
        if (entries.get(filePath) === entry) entries.delete(filePath);
        return null;
      }
    } catch {
      entries.delete(filePath);
      return null;
    }
  };
}

const readSourceJson = createJsonFileReader();

// Serves a cached value for `ttlMs`, collapses concurrent callers onto one
// in-flight load, and keeps the last good value when a refresh throws.
function memoizeAsync(ttlMs, loader) {
  const entries = new Map();
  return (key = "") => {
    const entry = entries.get(key);
    if (entry?.inFlight) return entry.inFlight;
    if (entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value);
    const inFlight = Promise.resolve().then(() => loader(key)).then((value) => {
      entries.set(key, { at: Date.now(), value, inFlight: null });
      return value;
    }, (error) => {
      if (entry) entries.set(key, { at: entry.at, value: entry.value, inFlight: null });
      else entries.delete(key);
      throw error;
    });
    entries.set(key, { at: entry?.at ?? 0, value: entry?.value, inFlight });
    return inFlight;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finitePercent(value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 100) : null;
}

function parseCompact(value) {
  const match = String(value || "").replace(/,/g, "").match(/(-?[\d.]+)\s*([KMBT])?/i);
  if (!match) return 0;
  const multiplier = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[String(match[2] || "").toLowerCase()] || 1;
  return Number(match[1]) * multiplier;
}

function runCommand(command, args, timeout = 5500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout = "") => {
      resolve(error ? "" : stdout);
    });
  });
}

function sendJsonLine(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function rateLimitWindow(window) {
  if (!window) return null;
  const duration = Number(window.windowDurationMins) || null;
  const tag = duration === 300 ? "5H" : duration === 10080 ? "7D" : duration === 43200 ? "30D" : duration ? `${Math.round(duration / 1440)}D` : "LIVE";
  const label = duration === 300 ? "5 hour window" : duration === 10080 ? "Weekly window" : duration === 43200 ? "30 day window" : duration ? `${Math.round(duration / 1440)} day window` : "Current window";
  const reportedUsed = finitePercent(window.usedPercent ?? window.usedPercentage ?? window.percentUsed);
  const reportedRemaining = finitePercent(window.remainingPercent ?? window.remainingPercentage ?? window.percentRemaining);
  // Prefer an explicitly reported remainder. Some provider responses round
  // used and remaining independently, so deriving used from the remainder
  // keeps every Pulse surface internally consistent.
  const remainingPercent = reportedRemaining ?? (reportedUsed === null ? null : 100 - reportedUsed);
  const usedPercent = remainingPercent === null ? null : 100 - remainingPercent;
  return {
    tag,
    label,
    usedPercent,
    remainingPercent,
    reported: remainingPercent !== null,
    windowDurationMins: duration,
    resetsAt: Number(window.resetsAt) || null
  };
}

function normalizeCodexAccount(account, response) {
  const rateResponse = response?.rate || null;
  const usageResponse = response?.usage || null;
  const buckets = rateResponse?.rateLimitsByLimitId || {};
  const snapshot = buckets.codex || rateResponse?.rateLimits || null;
  const windows = [rateLimitWindow(snapshot?.primary), rateLimitWindow(snapshot?.secondary)].filter(Boolean);
  const connected = Boolean(snapshot);
  const lifetimeTokens = Number(usageResponse?.summary?.lifetimeTokens) || 0;
  const usageExact = Boolean(usageResponse && Array.isArray(usageResponse.dailyUsageBuckets) && (usageResponse.dailyUsageBuckets.length > 0 || lifetimeTokens === 0));
  const fetchedAt = Date.now();
  const bankedResetsValue = snapshot?.bankedResets ?? snapshot?.credits?.bankedResets ?? null;
  return {
    id: account.id,
    profile: account.profile,
    plan: snapshot?.planType || account.fallbackPlan,
    planSource: snapshot?.planType ? "providerReported" : account.fallbackPlan ? "fallback" : "unreported",
    connected,
    exact: connected,
    rateStale: false,
    usageExact,
    usageStale: false,
    windows,
    credits: snapshot?.credits || null,
    bankedResets: bankedResetsValue !== null && Number.isFinite(Number(bankedResetsValue)) ? Number(bankedResetsValue) : null,
    rateLimitReachedType: snapshot?.rateLimitReachedType || null,
    dailyUsage: usageExact ? usageResponse.dailyUsageBuckets : [],
    lifetimeTokens,
    rateFetchedAt: connected ? fetchedAt : null,
    usageFetchedAt: usageExact ? fetchedAt : null,
    fetchedAt
  };
}

function stabilizeCodexAccount(account) {
  const cached = codexAccountSnapshotCache.get(account.id) || {};
  const nextCache = { ...cached };
  let stabilized = { ...account };
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  if (account.exact) {
    nextCache.rate = {
      plan: account.plan,
      planSource: account.planSource,
      connected: account.connected,
      windows: account.windows,
      credits: account.credits,
      bankedResets: account.bankedResets,
      rateLimitReachedType: account.rateLimitReachedType,
      rateFetchedAt: account.rateFetchedAt
    };
  } else if (cached.rate && Number(cached.rate.rateFetchedAt) >= cutoff) {
    stabilized = { ...stabilized, ...cached.rate, exact: false, connected: true, rateStale: true };
  } else {
    delete nextCache.rate;
  }

  if (account.usageExact) {
    nextCache.usage = {
      dailyUsage: account.dailyUsage,
      lifetimeTokens: account.lifetimeTokens,
      usageFetchedAt: account.usageFetchedAt
    };
  } else if (cached.usage && Number(cached.usage.usageFetchedAt) >= cutoff) {
    stabilized = { ...stabilized, ...cached.usage, usageExact: false, usageStale: true };
  } else {
    delete nextCache.usage;
  }

  // A reset boundary makes the old percentage historical. Keep the last value
  // as context, but wait for a new window instead of assuming a full refill.
  stabilized.windows = (stabilized.windows || []).map((window) => {
    const expired = Number(window.resetsAt) > 0 && Number(window.resetsAt) * 1000 <= now;
    const reported = finitePercent(window.remainingPercent) !== null;
    return {
      ...window,
      reported: reported && !expired,
      status: expired ? "reset_pending" : !reported ? "unreported" : stabilized.rateStale ? "cached" : "current",
      ...(expired ? { lastKnownRemainingPercent: window.remainingPercent, remainingPercent: null, usedPercent: null } : {})
    };
  });
  stabilized.rateStatus = !stabilized.connected ? "unavailable" : stabilized.rateStale ? "cached" : "current";
  stabilized.rateAgeMs = stabilized.rateFetchedAt ? Math.max(0, now - stabilized.rateFetchedAt) : null;
  stabilized.usageAgeMs = stabilized.usageFetchedAt ? Math.max(0, now - stabilized.usageFetchedAt) : null;
  if (account.exact || account.usageExact) nextCache.updatedAt = now;
  codexAccountSnapshotCache.set(account.id, nextCache);
  return stabilized;
}

function readCodexRateLimits(account) {
  return new Promise((resolve) => {
    const codexCommand = process.env.CODEX_BIN || "codex";
    let child;
    try {
      child = spawn(codexCommand, ["app-server", "--listen", "stdio://"], {
        // In a packaged app __dirname is inside app.asar, which is not a real
        // directory a child process can use. The user's home works in both modes.
        cwd: homeDir,
        env: { ...process.env, CODEX_HOME: account.home },
        stdio: ["pipe", "pipe", "ignore"]
      });
    } catch {
      resolve(normalizeCodexAccount(account, null));
      return;
    }
    let buffer = "";
    let settled = false;
    let requestSent = false;
    let rateResponse;
    let usageResponse;
    const timeout = setTimeout(() => finish(null), 6500);
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      resolve(normalizeCodexAccount(account, response || { rate: rateResponse, usage: usageResponse }));
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            sendJsonLine(child, { method: "initialized", params: {} });
            if (!requestSent) {
              requestSent = true;
              sendJsonLine(child, { id: 2, method: "account/rateLimits/read", params: null });
              sendJsonLine(child, { id: 3, method: "account/usage/read", params: null });
            }
          }
          if (message.id === 2) rateResponse = message.result || null;
          if (message.id === 3) usageResponse = message.result || null;
          if (rateResponse !== undefined && usageResponse !== undefined) finish({ rate: rateResponse, usage: usageResponse });
        } catch {
          // App-server can emit non-JSON diagnostics on some CLI builds.
        }
      }
    });
    child.on("error", () => finish(null));
    child.stdin.on("error", () => finish(null));
    child.on("close", () => finish(null));
    sendJsonLine(child, { id: 1, method: "initialize", params: { clientInfo: { name: "usage-pulse", version: "0.1.0" }, capabilities: { experimentalApi: true } } });
  });
}

async function readCodexAccounts() {
  await ensureAccountSnapshotCache();
  const accounts = await Promise.all(codexAccountBlueprints.map(readCodexRateLimits));
  const stabilized = accounts.map(stabilizeCodexAccount);
  await persistAccountSnapshotCache();
  return stabilized;
}

async function walkRecentFiles(directory, minimumMtimeMs) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkRecentFiles(filePath, minimumMtimeMs);
    if (!entry.name.endsWith(".jsonl")) return [];
    const stats = await fs.stat(filePath).catch(() => null);
    return stats?.isFile() && stats.mtimeMs >= minimumMtimeMs ? [filePath] : [];
  }));
  return nested.flat();
}

async function walkTranscriptStats(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTranscriptStats(filePath);
    if (!entry.name.endsWith(".jsonl") || entry.name.endsWith(".checkpoints.jsonl")) return [];
    const stats = await fs.stat(filePath).catch(() => null);
    return stats?.isFile() ? [{ filePath, signature: `${stats.mtimeMs}:${stats.size}` }] : [];
  }));
  return nested.flat();
}

// Codex rollout transcripts routinely reach hundreds of megabytes. Lines are
// located and pre-filtered on raw bytes -- Buffer#indexOf is a native search,
// and UTF-8 never emits 0x0A inside a multi-byte sequence -- so nothing is
// decoded or parsed for the ~99% of lines that carry no usage record.
const newlineByte = 0x0a;

function matchesMarker(line, markers) {
  for (const marker of markers) {
    if (line.includes(marker)) return true;
  }
  return false;
}

// Retain only compact usage records from stable files. Full conversation text
// stays on disk, and a bounded LRU keeps long-running desktop sessions small.
function createTranscriptScanner({ stat = fs.stat, readStream = createReadStream, maxCacheBytes = 16 * 1024 * 1024, maxEntries = 256 } = {}) {
  const entries = new Map();
  let cachedBytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (entry) cachedBytes -= entry.bytes;
    entries.delete(key);
  }
  return async function scanJsonlFile(filePath, markers, onRecord, project = null) {
    const cacheKey = `${filePath}\0${markers.map(marker => marker.toString("hex")).join(":")}`;
    const stats = project ? await stat(filePath).catch(() => null) : null;
    const signature = stats ? fileSignature(stats) : null;
    const cached = entries.get(cacheKey);
    if (cached && cached.signature === signature && cached.project === project) {
      entries.delete(cacheKey);
      entries.set(cacheKey, cached);
      let used = false;
      for (const record of cached.records) if (onRecord(record) === true) used = true;
      return used;
    }
    remove(cacheKey);
    let records = project && signature ? [] : null;
    let bytes = 0;
    let complete = true;
    let used = false;
    let carry = [];
    let carryLength = 0;
    const handleLine = (line) => {
      if (line.length < 2 || !matchesMarker(line, markers)) return;
      let record;
      try {
        record = JSON.parse(line.toString("utf8"));
      } catch {
        return;
      }
      if (project) {
        record = project(record);
        if (!record) return;
      }
      if (records) {
        bytes += Buffer.byteLength(JSON.stringify(record));
        if (bytes <= maxCacheBytes) records.push(record);
        else records = null;
      }
      if (onRecord(record) === true) used = true;
    };
    try {
      for await (const chunk of readStream(filePath, { highWaterMark: 1 << 20 })) {
        if (chunk.indexOf(newlineByte) === -1) {
          // A single record can exceed the read size; hold the pieces so that a
          // long line costs one copy rather than one per chunk.
          carry.push(chunk);
          carryLength += chunk.length;
          continue;
        }
        let buffer = chunk;
        if (carryLength > 0) {
          carry.push(chunk);
          buffer = Buffer.concat(carry, carryLength + chunk.length);
          carry = [];
          carryLength = 0;
        }
        let start = 0;
        let newline = buffer.indexOf(newlineByte);
        while (newline !== -1) {
          handleLine(buffer.subarray(start, newline));
          start = newline + 1;
          newline = buffer.indexOf(newlineByte, start);
        }
        if (start < buffer.length) {
          const tail = buffer.subarray(start);
          carry.push(tail);
          carryLength = tail.length;
        }
      }
    } catch {
      // A partially written or unreadable transcript still contributes whatever
      // complete records were parsed before the failure, but is never cached.
      complete = false;
    }
    if (carryLength > 0) handleLine(Buffer.concat(carry, carryLength));
    if (records && complete && signature === fileSignature(await stat(filePath).catch(() => ({})))) {
      remove(cacheKey);
      entries.set(cacheKey, { signature, project, records, bytes });
      cachedBytes += bytes;
      while (cachedBytes > maxCacheBytes || entries.size > maxEntries) remove(entries.keys().next().value);
    }
    return used;
  };
}

const scanJsonlFile = createTranscriptScanner();

function projectCodexUsageRecord(record) {
  const payload = record?.payload;
  if (record?.type === "session_meta") return { type: record.type, payload: { id: payload?.id } };
  if (record?.type === "turn_context") return { type: record.type, payload: { model: payload?.model } };
  if (record?.type !== "token_usage_record" || !payload?.usage) return null;
  return { type: record.type, timestamp: record.timestamp, payload: { response_id: payload.response_id, usage: payload.usage } };
}

function projectClaudeUsageRecord(record) {
  if (record?.type !== "assistant" || !record.message?.usage) return null;
  return {
    type: record.type, timestamp: record.timestamp, uuid: record.uuid, sessionId: record.sessionId,
    model: record.model, quotaLimits: record.quotaLimits,
    message: { id: record.message.id, model: record.message.model, usage: record.message.usage }
  };
}

const codexUsageMarkers = [Buffer.from("token_usage_record"), Buffer.from("turn_context"), Buffer.from("session_meta")];
const usageMarkers = [Buffer.from("usage"), Buffer.from("quotaLimits")];

function modelIndexFor(models) {
  const index = new Map();
  for (const model of models) index.set(`${model.name}\u0000${model.provider}`, model);
  return index;
}

function addModelUsage(models, index, name, provider, cost, tokens) {
  const key = `${name}\u0000${provider}`;
  let target = index.get(key);
  if (!target) {
    target = { name, provider, cost: 0, tokens: 0 };
    index.set(key, target);
    models.push(target);
  }
  target.cost += cost;
  target.tokens += tokens;
}

async function recentCodexSessionFiles(minimumMtimeMs) {
  const roots = new Set();
  for (const account of codexAccountBlueprints) {
    const root = await fs.realpath(path.join(account.home, "sessions")).catch(() => null);
    if (root) roots.add(root);
  }
  const files = await Promise.all([...roots].map((root) => walkRecentFiles(root, minimumMtimeMs)));
  return [...new Set(files.flat())];
}

async function recentClaudeTranscriptFiles(minimumMtimeMs) {
  const root = await fs.realpath(path.join(homeDir, ".claude", "projects")).catch(() => null);
  return root ? walkRecentFiles(root, minimumMtimeMs) : [];
}

function latestCachedUsageTimestamps(cache) {
  const latest = { codex: 0, claude: 0 };
  for (const value of Object.values(cache?.files || {})) {
    const provider = value?.p;
    if (latest[provider] === undefined) continue;
    for (const row of value?.r || []) {
      const timestamp = Number(row?.[0]) || 0;
      if (timestamp > latest[provider]) latest[provider] = timestamp;
    }
  }
  return latest;
}

async function augmentWithRecentCodexSessions(cacheData, days, rates, cachedThroughMs) {
  const rangeDates = new Set(Object.keys(cacheData.daily));
  const live = { files: 0, records: 0, tokens: 0, cost: 0 };
  if (!rangeDates.size) return live;

  // The session supplement only covers data newer than the aggregate cache.
  // This keeps repeated polls idempotent and leaves historical deduplication
  // to the existing T3 usage scanner.
  const minimumTimestampMs = Math.max(Date.now() - days * 86_400_000, cachedThroughMs);
  const files = await recentCodexSessionFiles(minimumTimestampMs);
  const models = modelIndexFor(cacheData.models);

  for (const filePath of files) {
    let currentModel = "";
    let currentSession = path.basename(filePath, ".jsonl").match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)?.[0] || filePath;
    const responseIds = new Set();
    const used = await scanJsonlFile(filePath, codexUsageMarkers, (record) => {
      const payload = record?.payload || {};
      if (record?.type === "session_meta") {
        if (payload.id) currentSession = String(payload.id);
        return false;
      }
      if (record?.type === "turn_context") {
        if (payload.model) currentModel = String(payload.model);
        return false;
      }
      if (record?.type !== "token_usage_record" || !payload.usage) return false;

      const timestamp = Date.parse(record.timestamp || "");
      if (!Number.isFinite(timestamp) || timestamp <= minimumTimestampMs) return false;
      const date = dateKey(timestamp);
      if (!rangeDates.has(date) || !currentModel) return false;
      const responseId = String(payload.response_id || "");
      if (responseId && responseIds.has(responseId)) return false;
      if (responseId) responseIds.add(responseId);

      const usage = payload.usage;
      const input = Math.max(0, Number(usage.input_tokens) || 0);
      const cachedInput = Math.min(input, Math.max(0, Number(usage.cached_input_tokens ?? usage.cache_read_input_tokens) || 0));
      const cacheCreation = Math.max(0, Number(usage.cache_write_input_tokens ?? usage.cache_creation_input_tokens) || 0);
      const totals = {
        uncachedInput: Math.max(0, input - cachedInput - cacheCreation),
        cachedInput,
        cacheCreation,
        output: Math.max(0, Number(usage.output_tokens) || 0),
        reasoning: Math.max(0, Number(usage.reasoning_output_tokens) || 0)
      };
      const tokens = totals.uncachedInput + totals.cachedInput + totals.cacheCreation + totals.output;
      if (tokens <= 0) return false;

      const cost = priceTokens(rates, currentModel, totals);
      const aggregate = cacheData.aggregate.codex;
      aggregate.tokens += tokens;
      aggregate.cost += cost;
      aggregate.cacheSavings += cacheSavingsFor(rates, currentModel, totals);
      aggregate.uncachedInput += totals.uncachedInput;
      aggregate.cachedInput += totals.cachedInput;
      aggregate.cacheCreation += totals.cacheCreation;
      aggregate.output += totals.output;
      aggregate.reasoning += totals.reasoning;
      aggregate.sessionIds.add(currentSession);
      aggregate.sessions = aggregate.sessionIds.size;
      cacheData.daily[date].codex.tokens += tokens;
      cacheData.daily[date].codex.cost += cost;
      addModelUsage(cacheData.models, models, currentModel, "codex", cost, tokens);

      live.records += 1;
      live.tokens += tokens;
      live.cost += cost;
      return true;
    }, projectCodexUsageRecord);
    if (used) live.files += 1;
  }

  if (live.records) cacheData.models.sort((a, b) => b.cost - a.cost);
  return live;
}

async function augmentWithRecentClaudeSessions(cacheData, days, rates, cachedThroughMs) {
  const rangeDates = new Set(Object.keys(cacheData.daily));
  const live = { files: 0, records: 0, tokens: 0, cost: 0, quota: null };
  if (!rangeDates.size) return live;

  const minimumTimestampMs = Math.max(Date.now() - days * 86_400_000, cachedThroughMs);
  const files = await recentClaudeTranscriptFiles(minimumTimestampMs);
  const models = modelIndexFor(cacheData.models);
  let latestQuotaTimestamp = 0;

  for (const filePath of files) {
    const messageIds = new Set();
    const used = await scanJsonlFile(filePath, usageMarkers, (record) => {
      if (record?.type !== "assistant" || !record.message?.usage) return false;

      const timestamp = Date.parse(record.timestamp || "");
      if (!Number.isFinite(timestamp)) return false;
      if (record.quotaLimits && timestamp >= latestQuotaTimestamp) {
        latestQuotaTimestamp = timestamp;
        live.quota = {
          status: String(record.quotaLimits.status || "").toLowerCase(),
          rateLimitType: String(record.quotaLimits.rateLimitType || "").toLowerCase(),
          overageStatus: String(record.quotaLimits.overageStatus || "").toLowerCase(),
          resetsAt: Number(record.quotaLimits.resetsAt) || null,
          fetchedAt: timestamp
        };
      }
      if (timestamp <= minimumTimestampMs) return false;
      const date = dateKey(timestamp);
      if (!rangeDates.has(date)) return false;

      const messageId = String(record.message.id || record.uuid || "");
      if (messageId && messageIds.has(messageId)) return false;
      if (messageId) messageIds.add(messageId);

      const usage = record.message.usage;
      const totals = {
        uncachedInput: Math.max(0, Number(usage.input_tokens) || 0),
        cachedInput: Math.max(0, Number(usage.cache_read_input_tokens) || 0),
        cacheCreation: Math.max(0, Number(usage.cache_creation_input_tokens) || 0),
        output: Math.max(0, Number(usage.output_tokens) || 0),
        reasoning: Math.max(0, Number(usage.output_tokens_details?.thinking_tokens) || 0)
      };
      const tokens = totals.uncachedInput + totals.cachedInput + totals.cacheCreation + totals.output;
      if (tokens <= 0) return false;

      const model = String(record.message.model || record.model || "").trim();
      if (!model) return false;
      const cost = priceTokens(rates, model, totals);
      const aggregate = cacheData.aggregate.claude;
      aggregate.tokens += tokens;
      aggregate.cost += cost;
      aggregate.cacheSavings += cacheSavingsFor(rates, model, totals);
      aggregate.uncachedInput += totals.uncachedInput;
      aggregate.cachedInput += totals.cachedInput;
      aggregate.cacheCreation += totals.cacheCreation;
      aggregate.output += totals.output;
      aggregate.reasoning += totals.reasoning;
      aggregate.sessionIds.add(String(record.sessionId || path.basename(filePath, ".jsonl")));
      aggregate.sessions = aggregate.sessionIds.size;
      cacheData.daily[date].claude.tokens += tokens;
      cacheData.daily[date].claude.cost += cost;
      addModelUsage(cacheData.models, models, model, "claude", cost, tokens);

      live.records += 1;
      live.tokens += tokens;
      live.cost += cost;
      return true;
    }, projectClaudeUsageRecord);
    if (used) live.files += 1;
  }

  if (live.records) cacheData.models.sort((a, b) => b.cost - a.cost);
  return live;
}

function normalizeClaudeSubscription(status) {
  const connected = status?.loggedIn === true && status?.authMethod === "claude.ai";
  const plans = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };
  const plan = connected ? plans[String(status.subscriptionType || "").toLowerCase()] : null;
  // Account status also contains identity information. Only these display
  // fields leave this adapter; never forward the raw CLI response.
  return {
    connected,
    authStatusKnown: typeof status?.loggedIn === "boolean",
    plan: plan || "Not reported",
    planSource: plan ? "providerReported" : "unreported",
    subscriptionFetchedAt: connected ? Date.now() : null
  };
}

async function readClaudeSubscription() {
  const output = await runCommand(process.env.CLAUDE_BIN || "claude", ["auth", "status", "--json"]);
  try { return normalizeClaudeSubscription(JSON.parse(output)); }
  catch { return normalizeClaudeSubscription(null); }
}

function claudeLimitsFromQuota(quota, subscription = normalizeClaudeSubscription(null)) {
  const planMetadata = {
    plan: subscription.plan,
    planSource: subscription.planSource,
    connected: subscription.connected,
    subscriptionFetchedAt: subscription.subscriptionFetchedAt
  };
  if (!quota) return {
    ...planMetadata,
    note: subscription.connected ? "Claude Code · signed-in subscription" : "Claude Code · local quota records",
    fetchedAt: null,
    stale: false,
    status: "unreported",
    unreported: true,
    message: subscription.planSource === "providerReported"
      ? `Your Claude ${subscription.plan} subscription is connected. Remaining allowance has not been reported.`
      : "No current quota record is available. Remaining allowance and plan have not been reported."
  };
  const rejected = quota.status === "rejected" || quota.overageStatus === "rejected";
  const isWeekly = quota.rateLimitType === "seven_day" || quota.rateLimitType === "weekly";
  const isFiveHour = quota.rateLimitType === "five_hour";
  const windowDurationMins = isWeekly ? 10080 : isFiveHour ? 300 : null;
  const now = Date.now();
  const expired = Number(quota.resetsAt) > 0 && Number(quota.resetsAt) * 1000 <= now;
  const stale = expired || (windowDurationMins !== null && Number(quota.fetchedAt) > 0 && now - Number(quota.fetchedAt) >= windowDurationMins * 60_000);
  const metadata = {
    ...planMetadata,
    note: "Claude Code · local quota record",
    fetchedAt: quota.fetchedAt || null,
    stale,
    status: expired ? "reset_pending" : stale ? "stale" : rejected ? "reached" : "unreported"
  };
  if (!rejected || stale || windowDurationMins === null) {
    return {
      ...metadata,
      unreported: true,
      message: expired
        ? "The last reported reset has passed. Current allowance has not been reported yet."
        : stale
          ? "The last quota record is out of date. Current allowance has not been reported yet."
          : "Claude Code did not report a remaining percentage for a known quota window."
    };
  }
  return {
    ...metadata,
    limits: [{
      label: isWeekly ? "Weekly window" : "5 hour window",
      tag: isWeekly ? "7D" : "5H",
      remaining: 0,
      windowDurationMins,
      reported: true,
      resetsAt: quota.resetsAt
    }]
  };
}

const reportingDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// A local calendar date can only change on a 15-minute UTC boundary, because
// every real UTC offset is a multiple of 15 minutes. Bucketing by quarter hour
// is therefore exact, and turns ~70k Intl format calls per aggregate pass into
// a few thousand.
const dateKeyCache = new Map();

function dateKey(timestamp) {
  const bucket = Math.floor(timestamp / 900_000);
  const cached = dateKeyCache.get(bucket);
  if (cached !== undefined) return cached;
  const value = reportingDateFormatter.format(new Date(timestamp));
  if (dateKeyCache.size > 200_000) dateKeyCache.clear();
  dateKeyCache.set(bucket, value);
  return value;
}

const dateRangeCache = new Map();
let dateRangeCacheDay = "";

// The returned array is shared and frozen; callers only ever read from it.
function buildDateRange(days) {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const today = dateKey(now.getTime());
  if (today !== dateRangeCacheDay) {
    dateRangeCache.clear();
    dateRangeCacheDay = today;
  }
  const cached = dateRangeCache.get(days);
  if (cached) return cached;
  const result = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - index);
    result.push(dateKey(day.getTime()));
  }
  Object.freeze(result);
  dateRangeCache.set(days, result);
  return result;
}

function seedDaily(days) {
  const dates = buildDateRange(days);
  return dates.map((date, index) => {
    const wave = (phase, amount) => Math.max(0, amount + Math.sin(index * 0.82 + phase) * amount * 0.52 + Math.sin(index * 0.21 + phase) * amount * 0.35);
    const spike = (at, height, width = 1.2) => height * Math.exp(-((index - at) ** 2) / (2 * width ** 2));
    return {
      date,
      codex: Math.round(wave(0.4, 47) + spike(days * 0.19, 168) + spike(days * 0.49, 206) + spike(days * 0.76, 188)),
      claude: Math.round(wave(1.6, 22) + spike(days * 0.22, 64) + spike(days * 0.57, 92) + spike(days * 0.82, 71)),
      commandcode: Math.round(wave(0.9, 1.8) + spike(days * 0.42, 9, 2.5)),
      cursor: Math.round(wave(2.4, 1.3) + spike(days * 0.68, 6, 2.2)),
      opencode: Math.round(wave(3.2, 1.1) + spike(days * 0.35, 5, 2.4))
    };
  });
}

const unpriceableModels = new Set(["<synthetic>", "synthetic", "opus", "sonnet", "haiku", "fable"]);

function normalizeModelName(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function parseRateTable(document) {
  const table = new Map(builtInModelRates);
  if (!document || typeof document !== "object") return table;
  for (const [name, raw] of Object.entries(document)) {
    if (!raw || typeof raw !== "object") continue;
    const input = Number(raw.input_cost_per_token);
    const output = Number(raw.output_cost_per_token);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    table.set(normalizeModelName(name), {
      input,
      output,
      cacheRead: Number.isFinite(Number(raw.cache_read_input_token_cost)) ? Number(raw.cache_read_input_token_cost) : input,
      cacheCreation: Number.isFinite(Number(raw.cache_creation_input_token_cost)) ? Number(raw.cache_creation_input_token_cost) : input
    });
  }
  return table;
}

function modelRate(rates, model) {
  const normalized = normalizeModelName(model);
  if (!normalized || unpriceableModels.has(normalized)) return null;
  const datedModel = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return rates.get(normalized) || (datedModel !== normalized ? rates.get(datedModel) : null) || null;
}

function priceTokens(rates, model, totals, reportedCost = null) {
  const normalizedReportedCost = Number(reportedCost);
  // A zero cost in an older scan is often a cache miss for a newly released
  // model, not evidence that the request was free. Reprice those rows from
  // the current table/fallback, but preserve positive provider-reported costs.
  if (reportedCost !== null && reportedCost !== undefined && Number.isFinite(normalizedReportedCost) && normalizedReportedCost > 0) return normalizedReportedCost;
  const rate = modelRate(rates, model);
  if (!rate) return Number.isFinite(normalizedReportedCost) ? Math.max(0, normalizedReportedCost) : 0;
  return totals.uncachedInput * rate.input + totals.cachedInput * rate.cacheRead + totals.cacheCreation * rate.cacheCreation + totals.output * rate.output;
}

function cacheSavingsFor(rates, model, totals) {
  const rate = modelRate(rates, model);
  return rate ? totals.cachedInput * (rate.input - rate.cacheRead) : 0;
}

function emptyUsageAggregate() {
  return { tokens: 0, cost: 0, cacheSavings: 0, uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0, reasoning: 0, sessions: new Set() };
}

function aggregateLocalCache(cache, days, rates) {
  const rangeDates = new Set(buildDateRange(days));
  const daily = Object.fromEntries([...rangeDates].map((date) => [date, { codex: { tokens: 0, cost: 0 }, claude: { tokens: 0, cost: 0 } }]));
  const aggregate = { codex: emptyUsageAggregate(), claude: emptyUsageAggregate() };
  const models = new Map();
  const seen = new Set();
  const modelNames = Array.isArray(cache?.models) ? cache.models : [];
  const sessionNames = Array.isArray(cache?.sessions) ? cache.sessions : [];

  for (const value of Object.values(cache?.files || {})) {
    const provider = value?.p;
    if (!aggregate[provider]) continue;
    for (const row of value?.r || []) {
      if (!Array.isArray(row) || row.length < 10) continue;
      const timestamp = Number(row[0]);
      const day = Number.isFinite(timestamp) ? dateKey(timestamp) : "";
      if (!rangeDates.has(day)) continue;
      const dedupeKey = typeof row[8] === "string" ? row[8] : null;
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);
      const model = modelNames[Number(row[1])] || "unpriced";
      const session = sessionNames[Number(row[2])] || "";
      const totals = {
        uncachedInput: Math.max(0, Number(row[3]) || 0),
        cachedInput: Math.max(0, Number(row[4]) || 0),
        cacheCreation: Math.max(0, Number(row[5]) || 0),
        output: Math.max(0, Number(row[6]) || 0),
        reasoning: Math.max(0, Number(row[7]) || 0)
      };
      const tokens = totals.uncachedInput + totals.cachedInput + totals.cacheCreation + totals.output;
      const cost = priceTokens(rates, model, totals, typeof row[9] === "number" ? row[9] : null);
      const cacheSavings = cacheSavingsFor(rates, model, totals);
      const target = aggregate[provider];
      target.tokens += tokens;
      target.cost += cost;
      target.cacheSavings += cacheSavings;
      target.uncachedInput += totals.uncachedInput;
      target.cachedInput += totals.cachedInput;
      target.cacheCreation += totals.cacheCreation;
      target.output += totals.output;
      target.reasoning += totals.reasoning;
      if (session) target.sessions.add(session);
      daily[day][provider].tokens += tokens;
      daily[day][provider].cost += cost;
      const modelKey = `${provider}\u0000${model}`;
      const modelTarget = models.get(modelKey) || { name: model, provider, cost: 0, tokens: 0 };
      modelTarget.cost += cost;
      modelTarget.tokens += tokens;
      models.set(modelKey, modelTarget);
    }
  }

  for (const target of Object.values(aggregate)) {
    target.sessionIds = target.sessions;
    target.sessions = target.sessions.size;
  }
  return { aggregate, daily, models: [...models.values()].sort((a, b) => b.cost - a.cost) };
}

const commandCodeFileCache = new Map();

async function readCommandCodeEvents(filePath, signature) {
  const cached = commandCodeFileCache.get(filePath);
  if (cached?.signature === signature) return cached.events;
  const events = [];
  await scanJsonlFile(filePath, usageMarkers, (event) => {
    if (!event?.usage) return false;
    const timestamp = Date.parse(event.timestamp || "");
    if (!Number.isFinite(timestamp)) return false;
    const usage = event.usage;
    events.push({
      timestamp,
      uncachedInput: Math.max(0, Number(usage.inputTokens) || 0),
      output: Math.max(0, Number(usage.outputTokens) || 0),
      cachedInput: Math.max(0, Number(usage.cacheReadTokens) || 0),
      cacheCreation: Math.max(0, Number(usage.cacheWriteTokens) || 0),
      cost: Math.max(0, Number(usage.costUsd) || 0),
      model: event.model || "command-default"
    });
    return true;
  });
  commandCodeFileCache.set(filePath, { signature, events });
  return events;
}

// Command Code transcripts are append-only, so parsed events are reused until
// a file's size or mtime changes. Only the (cheap) range aggregation reruns.
async function aggregateCommandCode(days) {
  const start = Date.now() - days * 86_400_000;
  const daily = Object.fromEntries(buildDateRange(days).map((date) => [date, 0]));
  const dailyCost = Object.fromEntries(buildDateRange(days).map((date) => [date, 0]));
  const models = {};
  let tokens = 0;
  let cost = 0;
  let sessions = 0;
  let uncachedInput = 0;
  let cachedInput = 0;
  let cacheCreation = 0;
  let output = 0;
  let earliestTimestamp = null;
  const transcripts = await walkTranscriptStats(commandCodeProjectsPath);
  const liveFiles = new Set(transcripts.map((transcript) => transcript.filePath));
  for (const filePath of commandCodeFileCache.keys()) {
    if (!liveFiles.has(filePath)) commandCodeFileCache.delete(filePath);
  }

  for (const transcript of transcripts) {
    const events = await readCommandCodeEvents(transcript.filePath, transcript.signature);
    let used = false;
    for (const event of events) {
      earliestTimestamp = earliestTimestamp === null ? event.timestamp : Math.min(earliestTimestamp, event.timestamp);
      if (event.timestamp < start) continue;
      const eventTokens = event.uncachedInput + event.output + event.cachedInput + event.cacheCreation;
      tokens += eventTokens;
      cost += event.cost;
      uncachedInput += event.uncachedInput;
      cachedInput += event.cachedInput;
      cacheCreation += event.cacheCreation;
      output += event.output;
      const key = dateKey(event.timestamp);
      if (daily[key] !== undefined) daily[key] += eventTokens;
      if (dailyCost[key] !== undefined) dailyCost[key] += event.cost;
      const modelUsage = models[event.model] || { tokens: 0, cost: 0 };
      modelUsage.tokens += eventTokens;
      modelUsage.cost += event.cost;
      models[event.model] = modelUsage;
      used = true;
    }
    if (used) sessions += 1;
  }

  return { tokens, cost, sessions, detected: transcripts.length > 0, daily, dailyCost, models, uncachedInput, cachedInput, cacheCreation, output, earliestTimestamp };
}

function availableHistoryDays(cache, accounts, commandCodeEarliestTimestamp) {
  let earliestTimestamp = Number.isFinite(commandCodeEarliestTimestamp) ? commandCodeEarliestTimestamp : null;
  const includeTimestamp = (timestamp) => {
    if (!Number.isFinite(timestamp)) return;
    earliestTimestamp = earliestTimestamp === null ? timestamp : Math.min(earliestTimestamp, timestamp);
  };
  for (const file of Object.values(cache?.files || {})) {
    for (const row of file?.r || []) {
      includeTimestamp(Number(row?.[0]));
    }
  }
  for (const account of accounts) {
    for (const bucket of account.dailyUsage || []) {
      includeTimestamp(Date.parse(`${bucket.startDate || ""}T12:00:00`));
    }
  }
  if (earliestTimestamp === null) return 90;
  return clamp(Math.ceil((Date.now() - earliestTimestamp) / 86_400_000) + 1, 7, lifetimeLookbackDays);
}

function parseOpenCodeStats(text) {
  if (!text) return null;
  const input = parseCompact(text.match(/\nInput\s+([\d.,]+\s*[KMBT]?)/i)?.[1]);
  const output = parseCompact(text.match(/\nOutput\s+([\d.,]+\s*[KMBT]?)/i)?.[1]);
  const cacheRead = parseCompact(text.match(/\nCache Read\s+([\d.,]+\s*[KMBT]?)/i)?.[1]);
  const sessionsMatch = text.match(/\nSessions\s+(\d+)/i);
  const sessions = sessionsMatch ? Number(sessionsMatch[1]) : null;
  const tokens = input + output + cacheRead;
  return tokens > 0 || sessions !== null ? { tokens, sessions, input, output, cacheRead } : null;
}

function distributeCost(daily, providerId, totalCost, totalTokens, field = providerId) {
  const total = daily.reduce((sum, point) => sum + (Number(point[field]) || 0), 0);
  const tokens = Number(totalTokens) || 0;
  for (const point of daily) {
    const share = total ? point[field] / total : 0;
    point[providerId] = total ? Number((share * totalCost).toFixed(2)) : 0;
    point[`${providerId}Tokens`] = total ? Number((share * tokens).toFixed(0)) : 0;
  }
  return daily;
}

function estimateCost(baseCost, baseTokens, tokens) {
  const normalizedBaseCost = Math.max(0, Number(baseCost) || 0);
  const normalizedBaseTokens = Math.max(1, Number(baseTokens) || 0);
  const normalizedTokens = Math.max(0, Number(tokens) || 0);
  return normalizedBaseCost * normalizedTokens / normalizedBaseTokens;
}

function aggregateCodexUsage(accounts, days, lifetime = false) {
  const rangeDates = new Set(buildDateRange(days));
  const baselineDates = new Set(buildDateRange(30));
  const daily = Object.fromEntries([...rangeDates].map((date) => [date, 0]));
  let rangeTokens = 0;
  let baselineTokens = 0;
  const normalizedAccounts = accounts.map((account) => {
    let accountRangeTokens = 0;
    let accountBaselineTokens = 0;
    for (const bucket of account.dailyUsage || []) {
      const date = bucket.startDate;
      const tokens = Math.max(0, Number(bucket.tokens) || 0);
      if (rangeDates.has(date)) {
        daily[date] += tokens;
        rangeTokens += tokens;
        accountRangeTokens += tokens;
      }
      if (baselineDates.has(date)) {
        baselineTokens += tokens;
        accountBaselineTokens += tokens;
      }
    }
    if (lifetime) {
      const lifetimeTokens = Math.max(0, Number(account.lifetimeTokens) || 0);
      const unbucketedTokens = Math.max(0, lifetimeTokens - accountRangeTokens);
      accountRangeTokens += unbucketedTokens;
      rangeTokens += unbucketedTokens;
    }
    const { dailyUsage, ...accountWithoutBuckets } = account;
    return { ...accountWithoutBuckets, rangeTokens: accountRangeTokens, baselineTokens: accountBaselineTokens };
  });
  return { daily, rangeTokens, baselineTokens, accounts: normalizedAccounts };
}

function includeAllCodexAccountUsage(cacheData, codexUsage) {
  const observed = cacheData.aggregate.codex;
  const uncoveredTokens = Math.max(0, codexUsage.rangeTokens - observed.tokens);
  if (uncoveredTokens <= 0) return { uncoveredTokens: 0, accountTokens: codexUsage.rangeTokens, transcriptTokens: observed.tokens };

  const blendedCostPerToken = observed.tokens > 0 ? observed.cost / observed.tokens : providerBlueprints[0].cost / providerBlueprints[0].tokens;
  const blendedSavingsPerToken = observed.tokens > 0 ? observed.cacheSavings / observed.tokens : 0;
  const gaps = Object.entries(codexUsage.daily).map(([date, accountTokens]) => {
    const transcriptTokens = cacheData.daily[date]?.codex?.tokens || 0;
    return { date, tokens: Math.max(0, Number(accountTokens) - transcriptTokens) };
  });
  const gapTotal = gaps.reduce((sum, gap) => sum + gap.tokens, 0);
  const scale = gapTotal > 0 ? uncoveredTokens / gapTotal : 0;
  if (gapTotal > 0) {
    for (const gap of gaps) {
      const tokens = gap.tokens * scale;
      cacheData.daily[gap.date].codex.tokens += tokens;
      cacheData.daily[gap.date].codex.cost += tokens * blendedCostPerToken;
    }
  } else {
    const lastDate = dateKey(Date.now());
    if (lastDate && cacheData.daily[lastDate]) {
      cacheData.daily[lastDate].codex.tokens += uncoveredTokens;
      cacheData.daily[lastDate].codex.cost += uncoveredTokens * blendedCostPerToken;
    }
  }

  const addedCost = uncoveredTokens * blendedCostPerToken;
  observed.tokens += uncoveredTokens;
  observed.cost += addedCost;
  observed.cacheSavings += uncoveredTokens * blendedSavingsPerToken;
  cacheData.models.push({ name: "unattributed account usage", provider: "codex", tokens: uncoveredTokens, cost: addedCost });
  cacheData.models.sort((a, b) => b.cost - a.cost);
  return { uncoveredTokens, accountTokens: codexUsage.rangeTokens, transcriptTokens: observed.tokens - uncoveredTokens };
}

const cachedCodexAccounts = memoizeAsync(codexAccountsTtlMs, () => readCodexAccounts());
const cachedClaudeSubscription = memoizeAsync(60000, readClaudeSubscription);
const currentClaudeUsage = createClaudeUsageMonitor({
  collect: () => readClaudeUsage({ command: process.env.CLAUDE_BIN || "claude", cwd: homeDir }),
  load: () => readJson(claudeUsageCachePath),
  save: async (snapshot) => {
    await fs.mkdir(path.dirname(claudeUsageCachePath), { recursive: true });
    const temporary = `${claudeUsageCachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await fs.rename(temporary, claudeUsageCachePath);
  }
});
const cachedOpenCodeStats = memoizeAsync(openCodeTtlMs, (days) => runCommand("opencode", ["stats", "--days", days]));

async function buildSnapshot(days) {
  const lifetime = days === "lifetime";
  const requestedDays = lifetime ? lifetimeLookbackDays : Number(days);
  const [cache, ratesCache, commandCodeData, openCodeText, rawCodexAccounts, claudeSubscription] = await Promise.all([
    readSourceJson(usageCachePath),
    readSourceJson(usageRatesPath),
    aggregateCommandCode(requestedDays),
    cachedOpenCodeStats(String(requestedDays)),
    cachedCodexAccounts(),
    cachedClaudeSubscription()
  ]);
  const safeDays = lifetime ? availableHistoryDays(cache, rawCodexAccounts, commandCodeData.earliestTimestamp) : requestedDays;
  const rates = parseRateTable(ratesCache?.document);
  const cacheData = aggregateLocalCache(cache, safeDays, rates);
  const cachedThrough = latestCachedUsageTimestamps(cache);
  const [liveCodexUsage, liveClaudeUsage, providerClaudeLimits] = await Promise.all([
    augmentWithRecentCodexSessions(cacheData, safeDays, rates, cachedThrough.codex),
    augmentWithRecentClaudeSessions(cacheData, safeDays, rates, cachedThrough.claude),
    currentClaudeUsage(claudeSubscription)
  ]);
  const transcriptClaudeLimits = claudeLimitsFromQuota(liveClaudeUsage.quota, claudeSubscription);
  const claudeLimits = providerClaudeLimits.limits?.some(window => window.reported) || !transcriptClaudeLimits.limits?.length
    ? providerClaudeLimits : transcriptClaudeLimits;
  const codexUsage = aggregateCodexUsage(rawCodexAccounts, safeDays, lifetime);
  const codexCoverage = includeAllCodexAccountUsage(cacheData, codexUsage);
  const openCodeStats = parseOpenCodeStats(openCodeText);
  const daily = seedDaily(safeDays);

  const providers = providerBlueprints.map((provider) => ({ ...provider, status: "unavailable", accounts: null, latency: null, sessions: null }));
  const codex = providers.find((provider) => provider.id === "codex");
  const claude = providers.find((provider) => provider.id === "claude");
  const commandcode = providers.find((provider) => provider.id === "commandcode");
  const cursor = providers.find((provider) => provider.id === "cursor");
  const opencode = providers.find((provider) => provider.id === "opencode");
  const codexBaseCost = codex.cost;
  const codexBaseTokens = codex.tokens;
  const commandcodeBaseCost = commandcode.cost;
  const commandcodeBaseTokens = commandcode.tokens;
  const opencodeBaseCost = opencode.cost;
  const opencodeBaseTokens = opencode.tokens;

  codex.cost = 0;
  codex.tokens = 0;
  claude.cost = 0;
  claude.tokens = 0;
  commandcode.cost = 0;
  commandcode.tokens = 0;
  cursor.cost = 0;
  cursor.tokens = 0;
  cursor.source = "Token telemetry unavailable";
  opencode.cost = 0;
  opencode.tokens = 0;

  const hasPricedCodexTranscripts = cacheData.aggregate.codex.tokens > 0;
  const hasPricedClaudeTranscripts = cacheData.aggregate.claude.tokens > 0;
  if (hasPricedCodexTranscripts) {
    codex.tokens = cacheData.aggregate.codex.tokens;
    codex.cost = cacheData.aggregate.codex.cost;
    codex.source = `${codexUsage.accounts.length} Codex accounts · T3 pricing`;
  } else if (codexUsage.rangeTokens > 0) {
    codex.tokens = codexUsage.rangeTokens;
    codex.cost = estimateCost(codexBaseCost, codexBaseTokens, codexUsage.rangeTokens);
    codex.source = `${codexUsage.accounts.length} Codex accounts · blended estimate`;
  }
  if (hasPricedClaudeTranscripts) {
    claude.tokens = cacheData.aggregate.claude.tokens;
    claude.cost = cacheData.aggregate.claude.cost;
    claude.source = "Local transcripts · T3 pricing";
  }
  if (commandCodeData.tokens > 0) {
    commandcode.tokens = commandCodeData.tokens;
    commandcode.sessions = commandCodeData.sessions;
    commandcode.source = "Local transcript usage";
    commandcode.cost = commandCodeData.cost > 0 ? commandCodeData.cost : estimateCost(commandcodeBaseCost, commandcodeBaseTokens, commandCodeData.tokens);
  }
  if (openCodeStats?.tokens > 0) {
    opencode.tokens = openCodeStats.tokens;
    opencode.cost = estimateCost(opencodeBaseCost, opencodeBaseTokens, opencode.tokens);
    opencode.source = "OpenCode stats";
  }
  // Detection describes an observed local source, not a provider connection or
  // authentication check. A missing session count stays unknown.
  const cachedProviders = new Set(Object.values(cache?.files || {}).map((file) => file?.p));
  codex.accounts = rawCodexAccounts.filter((account) => account.connected).length;
  codex.status = codex.accounts > 0 || cachedProviders.has("codex") || liveCodexUsage.records > 0 ? "detected" : "unavailable";
  claude.status = claudeSubscription.connected || cachedProviders.has("claude") || liveClaudeUsage.records > 0 ? "detected" : "unavailable";
  commandcode.status = commandCodeData.detected ? "detected" : "unavailable";
  opencode.status = openCodeStats ? "detected" : "unavailable";
  codex.sessions = cachedProviders.has("codex") || liveCodexUsage.records > 0 ? cacheData.aggregate.codex.sessions : null;
  claude.sessions = cachedProviders.has("claude") || liveClaudeUsage.records > 0 ? cacheData.aggregate.claude.sessions : null;
  commandcode.sessions = commandCodeData.detected ? commandCodeData.sessions : null;
  opencode.sessions = openCodeStats?.sessions ?? null;

  const openCodePointTotal = openCodeStats?.tokens > 0 ? daily.reduce((sum, point) => sum + point.opencode, 0) : 0;
  for (const point of daily) {
    const measured = cacheData.daily[point.date];
    point.codex = hasPricedCodexTranscripts ? measured?.codex.cost || 0 : codexUsage.daily[point.date] || 0;
    point.codexTokens = hasPricedCodexTranscripts ? measured?.codex.tokens || 0 : codexUsage.daily[point.date] || 0;
    point.claudeTokens = hasPricedClaudeTranscripts ? measured?.claude.tokens || 0 : 0;
    if (hasPricedClaudeTranscripts) point.claude = measured?.claude.cost || 0;
    if (commandCodeData.tokens > 0) {
      point.commandcode = commandCodeData.dailyCost[point.date] || 0;
      point.commandcodeTokens = commandCodeData.daily[point.date] || 0;
    }
    if (openCodePointTotal) point.opencode = Math.round((point.opencode / openCodePointTotal) * openCodeStats.tokens);
  }

  if (!hasPricedCodexTranscripts) distributeCost(daily, "codex", codex.cost, codex.tokens);
  if (!hasPricedClaudeTranscripts) distributeCost(daily, "claude", claude.cost, claude.tokens);
  if (!(commandCodeData.tokens > 0 && commandCodeData.cost > 0)) distributeCost(daily, "commandcode", commandcode.cost, commandcode.tokens);
  distributeCost(daily, "cursor", cursor.cost, cursor.tokens);
  distributeCost(daily, "opencode", opencode.cost, opencode.tokens);

  const totalCost = providers.reduce((sum, provider) => sum + provider.cost, 0);
  const totalTokens = providers.reduce((sum, provider) => sum + provider.tokens, 0);
  providers.forEach((provider) => {
    provider.share = totalCost ? (provider.cost / totalCost) * 100 : 0;
    provider.tokenShare = totalTokens ? (provider.tokens / totalTokens) * 100 : 0;
  });

  const commandModels = Object.entries(commandCodeData.models).map(([name, usage]) => ({ name, provider: "commandcode", tokens: usage.tokens, cost: usage.cost }));
  const adapterModels = [
    ...(cursor.tokens > 0 ? [{ name: "cursor-composer", provider: "cursor", tokens: cursor.tokens, cost: cursor.cost }] : []),
    ...(opencode.tokens > 0 ? [{ name: "openrouter/auto", provider: "opencode", tokens: opencode.tokens, cost: opencode.cost }] : [])
  ];
  const liveModels = [...cacheData.models, ...commandModels, ...adapterModels].sort((a, b) => b.cost - a.cost);
  const measured = [cacheData.aggregate.codex, cacheData.aggregate.claude];
  const cachedInput = measured.reduce((sum, value) => sum + value.cachedInput, 0) + commandCodeData.cachedInput + (openCodeStats?.cacheRead || 0);
  const uncachedInput = measured.reduce((sum, value) => sum + value.uncachedInput, 0) + commandCodeData.uncachedInput + (openCodeStats?.input || 0);
  const cacheCreationInput = measured.reduce((sum, value) => sum + value.cacheCreation, 0) + commandCodeData.cacheCreation;
  const output = measured.reduce((sum, value) => sum + value.output, 0) + commandCodeData.output + (openCodeStats?.output || 0);
  const estimatedUncachedValueAvoided = measured.reduce((sum, value) => sum + value.cacheSavings, 0);
  return {
    fetchedAt: Date.now(),
    rangeDays: safeDays,
    rangeKey: lifetime ? "lifetime" : String(safeDays),
    mode: cache ? "local adapters + account usage + session cache" : "local adapters + preview data",
    codexAccounts: codexUsage.accounts,
    limits: { claude: claudeLimits },
    providers,
    daily,
    models: liveModels,
    pricing: {
      source: "LiteLLM model_prices_and_context_window.json + built-in current model fallbacks",
      fetchedAt: ratesCache?.fetchedAtMs || null,
      knownModels: rates.size,
      fallbackModels: [...builtInModelRates.keys()],
      method: "T3-compatible per-model API estimate"
    },
    liveCodexUsage,
    liveClaudeUsage,
    summary: {
      totalCost,
      totalTokens,
      processedTokens: totalTokens,
      cachedInput,
      uncachedInput,
      cacheCreationInput,
      output,
      cacheSavings: estimatedUncachedValueAvoided,
      estimatedUncachedValueAvoided,
      costBasis: "api_estimate_from_observed_tokens",
      subscriptionChargesIncluded: false,
      codexCoverage,
      activeSessions: providers.reduce((sum, provider) => sum + (provider.sessions ?? 0), 0),
      observedSessions: providers.reduce((sum, provider) => sum + (provider.sessions ?? 0), 0),
      sessionCountBasis: "unique_observed_sessions_in_selected_range"
    }
  };
}

function snapshotCacheKey(days) {
  return String(days).toLowerCase() === "lifetime" ? "lifetime" : String(clamp(Number(days) || 30, 7, 90));
}

const cachedSnapshot = memoizeAsync(snapshotTtlMs, buildSnapshot);

function getSnapshot(days) {
  return cachedSnapshot(snapshotCacheKey(days));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[ext] || "application/octet-stream";
}

const publicRoot = publicDir.endsWith(path.sep) ? publicDir : `${publicDir}${path.sep}`;
const publicAssets = new Set(["index.html", "app.js", "styles.css", "dashboard-insights.js", "dashboard-insights.css", "marketing/index.html", "marketing/app.js", "marketing/styles.css", "marketing/assets/pulse-icon.png"]);
const staticFileCache = new Map();
const staticFileCacheLimit = 2 * 1024 * 1024;

function notFound() {
  const error = new Error("Not found");
  error.code = "ENOENT";
  return error;
}

// The dashboard assets are static for the life of a run, so they are validated
// by stat and served from memory. Browsers revalidate with If-None-Match and
// normally get a 304 instead of another ~130 KB of JS and CSS.
async function readStaticFile(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw notFound();
  const etag = `W/"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
  const cached = staticFileCache.get(filePath);
  if (cached?.etag === etag) return cached;
  const entry = { body: await fs.readFile(filePath), etag, type: contentType(filePath) };
  if (stats.size <= staticFileCacheLimit) staticFileCache.set(filePath, entry);
  else staticFileCache.delete(filePath);
  return entry;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/usage") {
      const payload = await getSnapshot(url.searchParams.get("days"));
      const body = Buffer.from(JSON.stringify(payload));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const requested = decodeURIComponent(pathname);
    const filePath = path.resolve(publicDir, `.${requested}`);
    // `startsWith(publicDir)` alone would also accept a sibling directory whose
    // name merely begins with the public root.
    if (filePath !== publicDir && !filePath.startsWith(publicRoot)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    const assetPath = path.relative(publicDir, filePath).split(path.sep).join("/");
    if (!publicAssets.has(assetPath)) throw notFound();
    const file = await readStaticFile(filePath);
    const headers = { "Content-Type": file.type, "Cache-Control": "no-cache", ETag: file.etag, "Content-Security-Policy": "frame-ancestors 'none'" };
    if (request.headers["if-none-match"] === file.etag) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": file.body.length });
    response.end(request.method === "HEAD" ? undefined : file.body);
  } catch (error) {
    const missing = error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR";
    response.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(missing ? "Not found" : "Server error");
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Usage Pulse running at http://127.0.0.1:${port}`);
  });
}

export {
  buildDateRange,
  createJsonFileReader,
  createTranscriptScanner,
  projectCodexUsageRecord,
  projectClaudeUsageRecord,
  claudeLimitsFromQuota,
  normalizeClaudeSubscription,
  getSnapshot,
  normalizeCodexAccount,
  normalizeModelName,
  parseRateTable,
  priceTokens,
  rateLimitWindow,
  server,
  stabilizeCodexAccount
};
