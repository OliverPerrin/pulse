// Claude Code's read-only get_usage control response reports utilization as a
// percentage. Only allowlisted display data crosses into Pulse's snapshots.
import { bankedResets } from './reset-credits.mjs';

const quotaWindows = [
  { key: 'five_hour', label: '5 hour window', tag: '5H', windowDurationMins: 300 },
  { key: 'seven_day', label: 'Weekly window', tag: '7D', windowDurationMins: 10080 }
];

function utilizationPercent(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function resetSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp / 1000) : null;
}

function subscriptionMetadata(subscription) {
  const allowedPlans = new Set(['Pro', 'Max', 'Team', 'Enterprise', 'Free']);
  const connected = subscription?.connected === true;
  const providerPlan = connected && subscription?.planSource === 'providerReported' && allowedPlans.has(subscription?.plan);
  const fetchedAt = Number(subscription?.subscriptionFetchedAt);
  return {
    connected,
    plan: providerPlan ? subscription.plan : 'Not reported',
    planSource: providerPlan ? 'providerReported' : 'unreported',
    subscriptionFetchedAt: connected && Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : null
  };
}

export function normalizeClaudeUsage(payload, { subscription = null, now = Date.now(), source = 'claude_code' } = {}) {
  const metadata = subscriptionMetadata(subscription);
  const timestamp = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const providerSource = source === 'claude_web' ? 'claude_web' : 'claude_code';
  let rateLimits = payload?.rate_limits;
  if (Array.isArray(rateLimits?.limits)) {
    const session = rateLimits.limits.find(row => row.kind === 'session');
    const weekly = rateLimits.limits.find(row => row.kind === 'weekly_all');
    rateLimits = { ...rateLimits,
      ...(session ? { five_hour: { utilization: session.percent, resets_at: session.resets_at } } : {}),
      ...(weekly ? { seven_day: { utilization: weekly.percent, resets_at: weekly.resets_at } } : {}) };
  }
  const limits = [];
  for (const { key, ...window } of quotaWindows) {
    const source = rateLimits?.[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const utilization = utilizationPercent(source.utilization);
    const resetsAt = resetSeconds(source.resets_at);
    const expired = resetsAt !== null && resetsAt * 1000 <= timestamp;
    const usedPercent = expired ? null : utilization;
    const remaining = usedPercent === null ? null : 100 - usedPercent;
    limits.push({
      ...window,
      remaining,
      remainingPercent: remaining,
      usedPercent,
      reported: remaining !== null,
      resetsAt,
      status: expired ? 'reset_pending' : remaining === null ? 'unreported' : remaining === 0 ? 'reached' : 'available'
    });
  }
  const reported = limits.filter((window) => window.reported);
  const stale = limits.some((window) => window.status === 'reset_pending');
  const status = !reported.length ? stale ? 'reset_pending' : 'unreported'
    : reported.length !== limits.length ? 'partial'
      : reported.some((window) => window.remaining === 0) ? 'reached' : 'available';
  const result = {
    ...metadata,
    bankedResets: bankedResets(payload) ?? bankedResets(payload?.rate_limits),
    source: providerSource,
    note: `${providerSource === 'claude_web' ? 'Claude usage page' : 'Claude Code'} · provider-reported usage`,
    fetchedAt: limits.length || bankedResets(payload) !== null || bankedResets(payload?.rate_limits) !== null ? timestamp : null,
    stale,
    status,
    unreported: !reported.length
  };
  if (limits.length) result.limits = limits;
  if (!reported.length) result.message = stale
    ? 'The reported reset has passed. Current allowance is awaiting a fresh provider snapshot.'
    : `${providerSource === 'claude_web' ? 'Claude usage page' : 'Claude Code'} has not reported a current usage allowance.`;
  return result;
}

export function markClaudeUsageStale(snapshot, { now = Date.now(), reason = 'unavailable' } = {}) {
  const timestamp = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const rate_limits = {};
  for (const definition of quotaWindows) {
    const window = snapshot?.limits?.find((entry) => entry.tag === definition.tag);
    if (!window) continue;
    rate_limits[definition.key] = {
      utilization: window.reported === true ? utilizationPercent(window.usedPercent) : null,
      resets_at: window.resetsAt
    };
  }
  const result = normalizeClaudeUsage({ rate_limits, bankedResets: bankedResets(snapshot) }, { subscription: snapshot, now: timestamp, source: snapshot?.source });
  const priorFetchedAt = snapshot?.fetchedAt;
  result.fetchedAt = typeof priorFetchedAt === 'number' && Number.isFinite(priorFetchedAt) && priorFetchedAt > 0 ? priorFetchedAt : null;
  result.note = `${result.source === 'claude_web' ? 'Claude usage page' : 'Claude Code'} · cached provider usage`;
  result.stale = true;
  result.status = result.unreported ? result.status : 'cached';
  result.message = result.unreported
    ? 'Current Claude allowance needs a fresh provider snapshot.'
    : 'Showing the last provider snapshot while Claude usage is unavailable.';
  // Network/CLI errors can contain private paths or provider response bodies.
  // Only known reason codes may leave this adapter.
  result.reason = ['unavailable', 'timeout', 'rate_limit', 'auth_required'].includes(reason) ? reason : 'unavailable';
  for (const window of result.limits || []) {
    if (window.reported) window.status = 'cached';
  }
  return result;
}
