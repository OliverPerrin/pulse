import assert from 'node:assert/strict';
import test from 'node:test';
import { markClaudeUsageStale, normalizeClaudeUsage } from '../claude-usage.mjs';

const now = Date.parse('2026-09-30T12:00:00Z');
const future = '2026-09-30T15:00:00Z';
const subscription = {
  connected: true, plan: 'Pro', planSource: 'providerReported', subscriptionFetchedAt: now
};

test('Claude provider usage normalizes independent 5-hour and weekly allowances', () => {
  const result = normalizeClaudeUsage({ rate_limits: {
    five_hour: { utilization: 13.5, resets_at: future },
    seven_day: { utilization: 61, resets_at: '2026-10-04T12:00:00Z' }
  } }, { subscription, now });
  assert.equal(result.plan, 'Pro');
  assert.equal(result.status, 'available');
  assert.equal(result.fetchedAt, now);
  assert.equal(result.unreported, false);
  assert.equal(result.stale, false);
  assert.deepEqual(result.limits.map(({ tag, remaining, usedPercent, windowDurationMins }) => ({ tag, remaining, usedPercent, windowDurationMins })), [
    { tag: '5H', remaining: 86.5, usedPercent: 13.5, windowDurationMins: 300 },
    { tag: '7D', remaining: 39, usedPercent: 61, windowDurationMins: 10080 }
  ]);
  assert.equal(result.limits[0].resetsAt, Date.parse(future) / 1000);
});

test('zero utilization and exhausted usage retain their exact meanings', () => {
  for (const [utilization, remaining, status] of [[0, 100, 'available'], [100, 0, 'reached'], ['12.5', 87.5, 'available']]) {
    const result = normalizeClaudeUsage({ rate_limits: { five_hour: { utilization, resets_at: future } } }, { now });
    assert.equal(result.limits[0].remaining, remaining);
    assert.equal(result.status, status);
    assert.equal(result.limits[0].reported, true);
  }
});

test('missing or malformed utilization never implies full or exhausted allowance', () => {
  for (const utilization of [undefined, null, '', '  ', false, true, {}, [], NaN, Infinity, 'unknown', -1, 101]) {
    const result = normalizeClaudeUsage({ rate_limits: { five_hour: { utilization, resets_at: future } } }, { now });
    assert.equal(result.limits[0].remaining, null);
    assert.equal(result.limits[0].usedPercent, null);
    assert.equal(result.limits[0].reported, false);
    assert.equal(result.unreported, true);
    assert.equal(result.status, 'unreported');
  }
  for (const payload of [null, {}, { rate_limits: null }, { rate_limits: { five_hour: null, seven_day: [] } }]) {
    const result = normalizeClaudeUsage(payload, { now });
    assert.equal(result.limits, undefined);
    assert.equal(result.fetchedAt, null);
    assert.equal(result.unreported, true);
  }
});

test('expired windows lose current percentages while fresh windows remain actionable', () => {
  const result = normalizeClaudeUsage({ rate_limits: {
    five_hour: { utilization: 100, resets_at: '2026-09-30T11:00:00Z' },
    seven_day: { utilization: 44, resets_at: future }
  } }, { now });
  assert.equal(result.status, 'partial');
  assert.equal(result.stale, true);
  assert.equal(result.unreported, false);
  assert.equal(result.limits[0].remaining, null);
  assert.equal(result.limits[0].status, 'reset_pending');
  assert.equal(result.limits[1].remaining, 56);
  const elapsed = normalizeClaudeUsage({ rate_limits: { five_hour: { utilization: 0, resets_at: now / 1000 } } }, { now });
  assert.equal(elapsed.status, 'reset_pending');
  assert.equal(elapsed.unreported, true);
});

test('unknown resets do not invent reset times or discard a reported utilization', () => {
  for (const resets_at of [null, undefined, '', 'invalid', false, {}, 0]) {
    const result = normalizeClaudeUsage({ rate_limits: { five_hour: { utilization: 25, resets_at } } }, { now });
    assert.equal(result.limits[0].resetsAt, null);
    assert.equal(result.limits[0].remaining, 75);
  }
});

test('Claude snapshot is an allowlist and never forwards credentials or account identity', () => {
  const secret = 'private-secret-marker';
  const result = normalizeClaudeUsage({
    accessToken: secret, email: secret, organization: { id: secret },
    rate_limits: {
      five_hour: { utilization: 10, resets_at: future, token: secret },
      undocumented_private_bucket: { utilization: 1, private_data: secret }
    }, debug: secret
  }, { subscription: { ...subscription, accessToken: secret, email: secret, orgId: secret }, now });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.limits.length, 1);
  assert.equal(result.connected, true);
  assert.deepEqual(Object.keys(result).sort(), ['connected', 'fetchedAt', 'limits', 'note', 'plan', 'planSource', 'source', 'stale', 'status', 'subscriptionFetchedAt', 'unreported']);
  for (const unsafeSubscription of [null, { ...subscription, connected: false }, { ...subscription, plan: secret }, { ...subscription, planSource: 'configured' }]) {
    const sanitized = normalizeClaudeUsage({}, { subscription: unsafeSubscription, now });
    assert.equal(sanitized.plan, 'Not reported');
    assert.equal(sanitized.planSource, 'unreported');
    assert.ok(!JSON.stringify(sanitized).includes(secret));
  }
});

test('cached usage retains the original observation time and expires each quota separately', () => {
  const original = normalizeClaudeUsage({ rate_limits: {
    five_hour: { utilization: 75, resets_at: '2026-09-30T12:01:00Z' },
    seven_day: { utilization: 10, resets_at: future }
  } }, { subscription, now });
  const cached = markClaudeUsageStale({ ...original, accessToken: 'private-secret' }, { now: now + 30_000, reason: 'private-secret' });
  assert.equal(cached.fetchedAt, now);
  assert.equal(cached.stale, true);
  assert.equal(cached.status, 'cached');
  assert.equal(cached.plan, 'Pro');
  assert.equal(cached.limits[0].remaining, 25);
  assert.equal(cached.limits[0].status, 'cached');
  assert.equal(cached.reason, 'unavailable');
  assert.ok(!JSON.stringify(cached).includes('private-secret'));
  const afterReset = markClaudeUsageStale(cached, { now: now + 61_000, reason: 'timeout' });
  assert.equal(afterReset.limits[0].remaining, null);
  assert.equal(afterReset.limits[0].reported, false);
  assert.equal(afterReset.limits[0].status, 'reset_pending');
  assert.equal(afterReset.limits[1].remaining, 90);
  assert.equal(afterReset.fetchedAt, now);
  assert.equal(afterReset.reason, 'timeout');
  assert.equal(original.limits[0].remaining, 25, 'cache normalization never mutates its source');
});

test('web usage retains its verified source through cache normalization and arbitrary source strings are discarded', () => {
  const payload = { rate_limits: { five_hour: { utilization: 47, resets_at: future }, seven_day: { utilization: 4, resets_at: '2026-10-04T20:59:59.563467+00:00' } } };
  const fresh = normalizeClaudeUsage(payload, { subscription, now, source: 'claude_web' });
  assert.equal(fresh.source, 'claude_web');
  assert.equal(fresh.note, 'Claude usage page · provider-reported usage');
  assert.equal(fresh.limits[0].remaining, 53);
  assert.equal(fresh.limits[1].remaining, 96);
  const cached = markClaudeUsageStale(fresh, { now: now + 30_000, reason: 'rate_limit' });
  assert.equal(cached.source, 'claude_web');
  assert.equal(cached.note, 'Claude usage page · cached provider usage');
  assert.equal(cached.fetchedAt, now);
  assert.equal(cached.limits[0].remaining, 53);
  const defaultSource = normalizeClaudeUsage(payload, { now, source: 'private-secret-marker' });
  assert.equal(defaultSource.source, 'claude_code');
  assert.equal(markClaudeUsageStale({ ...defaultSource, source: 'private-secret-marker' }).source, 'claude_code');
});
