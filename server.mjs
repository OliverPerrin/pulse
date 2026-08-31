import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = __dirname;
const port = Number(process.env.PORT || 5173);
const homeDir = process.env.HOME || "/Users/oliverperrin";
const usageCachePath = path.join(homeDir, ".t3", "userdata", "usage-scan-cache.json");
const usageRatesPath = path.join(homeDir, ".t3", "userdata", "usage-model-rates.json");
const accountSnapshotCachePath = path.join(homeDir, ".t3", "userdata", "usage-pulse-account-cache.json");
const commandCodeProjectsPath = path.join(homeDir, ".commandcode", "projects");
const lifetimeLookbackDays = 3650;

const providerBlueprints = [
  { id: "codex", name: "Codex", shortName: "Codex", color: "#e5e7eb", accounts: 3, cost: 1928.4, tokens: 8_330_000_000, status: "connected", source: "Local session cache", latency: "142ms" },
  { id: "claude", name: "Claude Code", shortName: "Claude", color: "#ff825f", accounts: 1, cost: 862.75, tokens: 1_170_000_000, status: "connected", source: "Local session cache", latency: "318ms" },
  { id: "commandcode", name: "Command Code", shortName: "Command", color: "#b99cff", accounts: 1, cost: 14.9, tokens: 84_300_000, status: "connected", source: "CLI account", latency: "204ms" },
  { id: "cursor", name: "Cursor", shortName: "Cursor", color: "#79a7ff", accounts: 1, cost: 8.31, tokens: 61_800_000, status: "connected", source: "Desktop bridge", latency: "—" },
  { id: "opencode", name: "OpenCode", shortName: "OpenCode", color: "#64dcc4", accounts: 1, cost: 4.78, tokens: 46_200_000, status: "connected", source: "Local stats", latency: "96ms" }
];

const codexAccountBlueprints = [
  { id: "codex-main", profile: ".codex", home: path.join(homeDir, ".codex"), fallbackPlan: "plus" },
  { id: "codex-alt", profile: ".codex-alt", home: path.join(homeDir, ".codex_alt"), fallbackPlan: "plus" },
  { id: "codex-alt2", profile: ".codex-alt2", home: path.join(homeDir, ".codex_alt2"), fallbackPlan: "free" }
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  return {
    tag,
    label,
    usedPercent: Math.max(0, Math.min(100, Number(window.usedPercent) || 0)),
    remainingPercent: Math.max(0, Math.min(100, 100 - (Number(window.usedPercent) || 0))),
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
  const fallbackReset = Math.floor(Date.now() / 1000) + (account.fallbackPlan === "free" ? 30 : 7) * 86_400;
  const fallbackWindow = account.fallbackPlan === "free"
    ? { tag: "30D", label: "30 day window", usedPercent: 0, remainingPercent: 100, windowDurationMins: 43200, resetsAt: fallbackReset }
    : { tag: "7D", label: "Weekly window", usedPercent: 0, remainingPercent: 100, windowDurationMins: 10080, resetsAt: fallbackReset };
  return {
    id: account.id,
    profile: account.profile,
    plan: snapshot?.planType || account.fallbackPlan,
    planSource: snapshot?.planType ? "providerReported" : "fallback",
    connected,
    exact: connected,
    rateStale: false,
    usageExact,
    usageStale: false,
    windows: windows.length ? windows : [fallbackWindow],
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
  } else if (cached.rate) {
    stabilized = { ...stabilized, ...cached.rate, exact: false, connected: true, rateStale: true };
  }

  if (account.usageExact) {
    nextCache.usage = {
      dailyUsage: account.dailyUsage,
      lifetimeTokens: account.lifetimeTokens,
      usageFetchedAt: account.usageFetchedAt
    };
  } else if (cached.usage) {
    stabilized = { ...stabilized, ...cached.usage, usageExact: false, usageStale: true };
  }

  if (account.exact || account.usageExact) nextCache.updatedAt = Date.now();
  codexAccountSnapshotCache.set(account.id, nextCache);
  return stabilized;
}

function readCodexRateLimits(account) {
  return new Promise((resolve) => {
    const codexCommand = process.env.CODEX_BIN || "codex";
    const child = spawn(codexCommand, ["app-server", "--listen", "stdio://"], {
      cwd: __dirname,
      env: { ...process.env, CODEX_HOME: account.home },
      stdio: ["pipe", "pipe", "ignore"]
    });
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
      resolve(normalizeCodexAccount(account, response));
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

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(filePath));
    else files.push(filePath);
  }
  return files;
}

const reportingDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function dateKey(timestamp) {
  return reportingDateFormatter.format(new Date(timestamp));
}

function buildDateRange(days) {
  const result = [];
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - index);
    result.push(day.toISOString().slice(0, 10));
  }
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
  const table = new Map();
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
  return rates.get(normalized) || null;
}

function priceTokens(rates, model, totals, reportedCost = null) {
  if (reportedCost !== null && Number.isFinite(Number(reportedCost))) return Number(reportedCost);
  const rate = modelRate(rates, model);
  if (!rate) return 0;
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
    target.sessions = target.sessions.size;
  }
  return { aggregate, daily, models: [...models.values()].sort((a, b) => b.cost - a.cost) };
}

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
  const files = (await walkFiles(commandCodeProjectsPath)).filter((filePath) => filePath.endsWith(".jsonl") && !filePath.endsWith(".checkpoints.jsonl"));

  for (const filePath of files) {
    const contents = await fs.readFile(filePath, "utf8").catch(() => "");
    let used = false;
    for (const line of contents.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (!event.usage) continue;
        const timestamp = Date.parse(event.timestamp || "");
        if (!Number.isFinite(timestamp)) continue;
        earliestTimestamp = earliestTimestamp === null ? timestamp : Math.min(earliestTimestamp, timestamp);
        if (timestamp < start) continue;
        const usage = event.usage;
        const eventUncached = Math.max(0, Number(usage.inputTokens) || 0);
        const eventOutput = Math.max(0, Number(usage.outputTokens) || 0);
        const eventCached = Math.max(0, Number(usage.cacheReadTokens) || 0);
        const eventCreation = Math.max(0, Number(usage.cacheWriteTokens) || 0);
        const eventCost = Math.max(0, Number(usage.costUsd) || 0);
        const eventTokens = eventUncached + eventOutput + eventCached + eventCreation;
        tokens += eventTokens;
        cost += eventCost;
        uncachedInput += eventUncached;
        cachedInput += eventCached;
        cacheCreation += eventCreation;
        output += eventOutput;
        const key = dateKey(timestamp);
        if (daily[key] !== undefined) daily[key] += eventTokens;
        if (dailyCost[key] !== undefined) dailyCost[key] += eventCost;
        const model = event.model || "command-default";
        const modelUsage = models[model] || { tokens: 0, cost: 0 };
        modelUsage.tokens += eventTokens;
        modelUsage.cost += eventCost;
        models[model] = modelUsage;
        used = true;
      } catch {
        // Ignore partial or non-JSON transcript lines.
      }
    }
    if (used) sessions += 1;
  }

  return { tokens, cost, sessions, daily, dailyCost, models, uncachedInput, cachedInput, cacheCreation, output, earliestTimestamp };
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
  const sessions = Number(text.match(/\nSessions\s+(\d+)/i)?.[1] || 0);
  const tokens = input + output + cacheRead;
  return tokens > 0 || sessions > 0 ? { tokens, sessions, input, output, cacheRead } : null;
}

function distributeCost(daily, providerId, totalCost, totalTokens, field = providerId) {
  const total = daily.reduce((sum, point) => sum + (Number(point[field]) || 0), 0);
  return daily.map((point) => ({
    ...point,
    [providerId]: total ? Number(((point[field] / total) * totalCost).toFixed(2)) : 0,
    [`${providerId}Tokens`]: total ? Number(((point[field] / total) * (Number(totalTokens) || 0)).toFixed(0)) : 0
  }));
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
    const lastDate = buildDateRange(Object.keys(cacheData.daily).length).at(-1);
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

async function getSnapshot(days) {
  const lifetime = String(days).toLowerCase() === "lifetime";
  const requestedDays = lifetime ? lifetimeLookbackDays : clamp(Number(days) || 30, 7, 90);
  const [cache, ratesCache, commandCodeData, openCodeText, rawCodexAccounts] = await Promise.all([
    readJson(usageCachePath),
    readJson(usageRatesPath),
    aggregateCommandCode(requestedDays),
    runCommand("opencode", ["stats", "--days", String(requestedDays)]),
    readCodexAccounts()
  ]);
  const safeDays = lifetime ? availableHistoryDays(cache, rawCodexAccounts, commandCodeData.earliestTimestamp) : requestedDays;
  const rates = parseRateTable(ratesCache?.document);
  const cacheData = aggregateLocalCache(cache, safeDays, rates);
  const codexUsage = aggregateCodexUsage(rawCodexAccounts, safeDays, lifetime);
  const codexCoverage = includeAllCodexAccountUsage(cacheData, codexUsage);
  const openCodeStats = parseOpenCodeStats(openCodeText);
  let daily = seedDaily(safeDays);

  const providers = providerBlueprints.map((provider) => ({ ...provider }));
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
    opencode.accounts = 1;
    opencode.source = "OpenCode stats";
  }
  // Cursor exposes connection health but not token totals, so it stays visible
  // without contributing fabricated tokens or API cost.

  daily = daily.map((point) => ({
    ...point,
    codex: hasPricedCodexTranscripts ? cacheData.daily[point.date]?.codex.cost || 0 : codexUsage.daily[point.date] || 0,
    codexTokens: hasPricedCodexTranscripts ? cacheData.daily[point.date]?.codex.tokens || 0 : codexUsage.daily[point.date] || 0,
    claude: hasPricedClaudeTranscripts ? cacheData.daily[point.date]?.claude.cost || 0 : point.claude,
    claudeTokens: hasPricedClaudeTranscripts ? cacheData.daily[point.date]?.claude.tokens || 0 : 0
  }));
  if (commandCodeData.tokens > 0) {
    daily = daily.map((point) => ({ ...point, commandcode: commandCodeData.dailyCost[point.date] || 0, commandcodeTokens: commandCodeData.daily[point.date] || 0 }));
  }

  if (openCodeStats?.tokens > 0) {
    const pointTotal = daily.reduce((sum, point) => sum + point.opencode, 0);
    daily = daily.map((point) => ({ ...point, opencode: pointTotal ? Math.round((point.opencode / pointTotal) * openCodeStats.tokens) : point.opencode }));
  }

  if (!hasPricedCodexTranscripts) daily = distributeCost(daily, "codex", codex.cost, codex.tokens);
  if (!hasPricedClaudeTranscripts) daily = distributeCost(daily, "claude", claude.cost, claude.tokens);
  if (!(commandCodeData.tokens > 0 && commandCodeData.cost > 0)) daily = distributeCost(daily, "commandcode", commandcode.cost, commandcode.tokens);
  daily = distributeCost(daily, "cursor", cursor.cost, cursor.tokens);
  daily = distributeCost(daily, "opencode", opencode.cost, opencode.tokens);

  const totalCost = providers.reduce((sum, provider) => sum + provider.cost, 0);
  const totalTokens = providers.reduce((sum, provider) => sum + provider.tokens, 0);
  providers.forEach((provider) => {
    provider.share = totalCost ? (provider.cost / totalCost) * 100 : 0;
    provider.tokenShare = totalTokens ? (provider.tokens / totalTokens) * 100 : 0;
    provider.sessions = provider.id === "codex" ? cacheData.aggregate.codex.sessions || codexUsage.accounts.length || 42 : provider.id === "claude" ? cacheData.aggregate.claude.sessions || 24 : provider.id === "opencode" ? openCodeStats?.sessions || 31 : provider.id === "commandcode" ? commandCodeData.sessions || 18 : 12;
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
    providers,
    daily,
    models: liveModels,
    pricing: {
      source: "LiteLLM model_prices_and_context_window.json",
      fetchedAt: ratesCache?.fetchedAtMs || null,
      knownModels: rates.size,
      method: "T3-compatible per-model API estimate"
    },
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
      activeSessions: providers.reduce((sum, provider) => sum + provider.sessions, 0)
    }
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[ext] || "application/octet-stream";
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/usage") {
      const payload = await getSnapshot(url.searchParams.get("days"));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(payload));
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const requested = decodeURIComponent(pathname);
    const filePath = path.resolve(publicDir, `.${requested}`);
    if (!filePath.startsWith(publicDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache", "Content-Security-Policy": "frame-ancestors 'none'" });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Usage Pulse running at http://127.0.0.1:${port}`);
  });
}

export { getSnapshot, normalizeCodexAccount, server, stabilizeCodexAccount };
