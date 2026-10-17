import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { bankedResets } from './reset-credits.mjs';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const INIT_ID = 'pulse-usage-initialize';
const USAGE_ID = 'pulse-usage-read';

function sanitizeUsage(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const rate_limits = {};
  for (const key of ['five_hour', 'seven_day']) {
    const window = response.rate_limits?.[key];
    if (!window || typeof window !== 'object' || Array.isArray(window)) continue;
    const utilization = window.utilization;
    if (typeof utilization !== 'number' || !Number.isFinite(utilization) || utilization < 0 || utilization > 100) continue;
    const reset = window.resets_at;
    // Null is valid for a window that has not started. Malformed dates are not.
    if (reset !== null && (typeof reset !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(reset) || !Number.isFinite(Date.parse(reset)))) continue;
    rate_limits[key] = { utilization, resets_at: reset };
  }
  // New CLI versions also expose provider-owned meter rows.
  if (Array.isArray(response.rate_limits?.limits)) {
    rate_limits.limits = response.rate_limits.limits.slice(0, 40).filter(row =>
      row && typeof row.kind === 'string' && typeof row.percent === 'number' && Number.isFinite(row.percent) && row.percent >= 0 && row.percent <= 100
      && (row.resets_at === null || typeof row.resets_at === 'string' && Number.isFinite(Date.parse(row.resets_at)))
    ).map(row => ({ kind: row.kind.slice(0, 64), percent: row.percent, resets_at: row.resets_at,
      ...(typeof row.scope?.model?.display_name === 'string' ? { model: row.scope.model.display_name.slice(0, 80) } : {}) }));
  }
  const resets = bankedResets(response) ?? bankedResets(response.rate_limits);
  if (!Object.keys(rate_limits).length && resets === null) return null;
  const result = { rate_limits };
  if (resets !== null) result.bankedResets = resets;
  if (['free', 'pro', 'max', 'team', 'enterprise'].includes(response.subscription_type)) result.subscription_type = response.subscription_type;
  return result;
}

/** Read Claude's own authenticated usage endpoint without sending a model prompt.
 * The experimental control protocol can change. Fail closed to an unavailable
 * result and retain only allowlisted quota fields and diagnostic reason codes.
 */
export function readClaudeUsage({ command = process.env.CLAUDE_BIN || 'claude', cwd = tmpdir(), env = process.env, timeoutMs = 20_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    let completed = false;
    let initialized = false;
    let output = '';
    let diagnostics = '';
    let totalBytes = 0;
    let reason = 'unavailable';
    let retryAfterSeconds = null;
    let timer;
    const detached = process.platform !== 'win32';

    function stopChild() {
      if (!child || child.exitCode != null || child.signalCode != null) return;
      const signal = (name) => {
        try {
          if (detached && Number.isInteger(child.pid) && child.pid > 1) process.kill(-child.pid, name);
          else child.kill(name);
        } catch { /* The owned child may have exited between observation and kill. */ }
      };
      const force = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) signal('SIGKILL');
      }, 1500);
      force.unref?.();
      child.once('close', () => clearTimeout(force));
      signal('SIGTERM');
    }

    function finish(payload = null, override = reason) {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      child?.stdin?.end();
      stopChild();
      output = '';
      diagnostics = '';
      resolve({ payload, reason: payload ? null : override, retryAfterSeconds: payload ? null : retryAfterSeconds });
    }

    function request(request_id, request) {
      try { child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id, request })}\n`); }
      catch { finish(); }
    }

    function consumeLine(line) {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.type !== 'control_response') return;
      const response = message.response;
      if (response?.request_id !== INIT_ID && response?.request_id !== USAGE_ID) return;
      if (response.subtype !== 'success') {
        const auth = typeof response.error === 'string' && /(?:not (?:logged|signed) in|unauthenticated|authentication required|auth(?:entication)? error|login required)/i.test(response.error);
        finish(null, auth ? 'auth_required' : reason);
        return;
      }
      if (response.request_id === INIT_ID && !initialized) {
        initialized = true;
        request(USAGE_ID, { subtype: 'get_usage', skip_behaviors: true });
      } else if (response.request_id === USAGE_ID && initialized) {
        const payload = sanitizeUsage(response.response);
        const unavailableReason = response.response?.rate_limits_available === false ? 'auth_required' : reason;
        finish(payload, unavailableReason);
      }
    }

    function consumeDiagnostic(line) {
      // Never forward diagnostic text: it may include account data or credentials.
      const cooldown = /fetchUtilization: 429 remembered for this bearer; not asking again for (\d+)s/.exec(line);
      if (cooldown) {
        reason = 'rate_limit';
        retryAfterSeconds = Math.min(86400, Number(cooldown[1]));
      } else if (/Request failed with status code 429/.test(line)) reason = 'rate_limit';
      else if (/Request failed with status code 401/.test(line)) reason = 'auth_required';
    }

    try {
      child = spawnImpl(command, [
        '--safe-mode', '--setting-sources', '', '--strict-mcp-config',
        '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
        '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--verbose', '--debug-to-stderr', '-p'
      ], { cwd, env, detached, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { finish(); return; }

    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20_000;
    timer = setTimeout(() => finish(null, 'timeout'), budget);
    child.on('error', () => finish());
    child.stdin?.on('error', () => finish());
    child.stdout?.on('data', (chunk) => {
      if (completed) return;
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > MAX_OUTPUT_BYTES) { finish(); return; }
      output += chunk.toString();
      let newline;
      while (!completed && (newline = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        consumeLine(line);
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (completed) return;
      // Keep at most a single short diagnostic line in memory, never a log.
      diagnostics += chunk.toString();
      let newline;
      while ((newline = diagnostics.indexOf('\n')) !== -1) {
        consumeDiagnostic(diagnostics.slice(0, newline));
        diagnostics = diagnostics.slice(newline + 1);
      }
      if (diagnostics.length > 4096) diagnostics = '';
    });
    child.on('close', () => {
      if (completed) return;
      if (diagnostics) consumeDiagnostic(diagnostics);
      if (output.trim()) consumeLine(output);
      finish();
    });
    request(INIT_ID, { subtype: 'initialize' });
  });
}
