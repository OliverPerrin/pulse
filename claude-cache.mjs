import { markClaudeUsageStale, normalizeClaudeUsage } from './claude-usage.mjs';

const reasons = new Set(['rate_limit', 'timeout', 'auth_required', 'unavailable']);
const DAY = 86400000;

// Active allowance is independent of the dashboard's historical date range.
// A provider cooldown survives process restarts without storing credentials.
export function createClaudeUsageMonitor({ collect, load = async () => null, save = async () => {}, clock = Date.now, ttlMs = 60000, maxAgeMs = DAY }) {
  let loaded = false, loading = null, lastGood = null, retryAt = 0, reason = null, freshUntil = 0, inFlight = null;
  async function persist() {
    await save({ version: 1, snapshot: lastGood, retryAt, reason }).catch(() => {});
  }
  async function initialize() {
    if (loaded) return;
    if (!loading) loading = (async () => {
      const cached = await load().catch(() => null);
      const now = clock();
      if (cached?.version === 1 && Number.isFinite(cached.snapshot?.fetchedAt) && cached.snapshot.fetchedAt <= now + 5000 && now - cached.snapshot.fetchedAt <= maxAgeMs) {
        lastGood = markClaudeUsageStale(cached.snapshot, { now, reason: cached.reason });
      }
      if (Number.isFinite(cached?.retryAt) && cached.retryAt > now && cached.retryAt <= now + DAY) retryAt = cached.retryAt;
      reason = reasons.has(cached?.reason) ? cached.reason : 'unavailable';
      loaded = true;
    })();
    await loading;
  }
  function view(subscription) {
    const now = clock();
    const usable = lastGood && now - lastGood.fetchedAt <= maxAgeMs;
    if (usable) {
      const metadata = { ...lastGood, connected: subscription.connected, plan: subscription.plan, planSource: subscription.planSource, subscriptionFetchedAt: subscription.subscriptionFetchedAt };
      const expired = metadata.limits?.some(window => window.resetsAt && window.resetsAt * 1000 <= now);
      if (!reason && now < freshUntil && !expired) return metadata;
      const result = markClaudeUsageStale(metadata, { now, reason });
      result.nextRetryAt = retryAt > now ? retryAt : null;
      result.message = reason === 'rate_limit'
        ? 'Claude is temporarily rate-limiting usage refreshes. Showing the last verified provider snapshot.'
        : 'Showing the last verified provider snapshot while Claude usage refresh is unavailable.';
      return result;
    }
    const result = normalizeClaudeUsage(null, { subscription, now });
    result.reason = reason || 'unavailable';
    result.nextRetryAt = retryAt > now ? retryAt : null;
    result.message = reason === 'rate_limit'
      ? 'Claude is temporarily rate-limiting usage refreshes. Pulse will retry after the provider cooldown.'
      : reason === 'auth_required' ? 'Claude usage requires a signed-in Claude subscription.'
        : 'Claude usage refresh is unavailable. Pulse will retry automatically.';
    return result;
  }
  return async function read(subscription) {
    await initialize();
    if (!subscription?.connected) {
      // A failed CLI status probe is not an explicit logout. Keep both the
      // verified snapshot and provider cooldown until authentication is known.
      if (subscription?.authStatusKnown === false) {
        freshUntil = 0;
        reason ||= 'unavailable';
        const prior = lastGood && clock() - lastGood.fetchedAt <= maxAgeMs ? lastGood : subscription;
        return view(prior);
      }
      lastGood = null; retryAt = 0; reason = 'auth_required'; freshUntil = 0;
      await persist();
      return view(subscription || {});
    }
    if (inFlight) { await inFlight; return view(subscription); }
    const now = clock();
    if (now < retryAt || (now < freshUntil && !lastGood?.limits?.some(window => window.resetsAt && window.resetsAt * 1000 <= now))) return view(subscription);
    inFlight = (async () => {
      let response;
      try { response = await collect(); } catch { response = { reason: 'unavailable' }; }
      const fetchedAt = clock();
      const normalized = normalizeClaudeUsage(response?.payload, { subscription, now: fetchedAt, source: 'claude_code' });
      if (normalized.limits?.some(window => window.reported)) {
        lastGood = normalized; reason = null; retryAt = 0; freshUntil = fetchedAt + ttlMs;
      } else {
        reason = reasons.has(response?.reason) ? response.reason : 'unavailable';
        const cooldown = typeof response?.retryAfterSeconds === 'number' && Number.isFinite(response.retryAfterSeconds) && response.retryAfterSeconds > 0
          ? Math.max(ttlMs, response.retryAfterSeconds * 1000)
          : reason === 'rate_limit' ? 900000 : ttlMs;
        retryAt = fetchedAt + Math.min(DAY, cooldown); freshUntil = 0;
      }
      await persist();
    })();
    try { await inFlight; return view(subscription); } finally { inFlight = null; }
  };
}
