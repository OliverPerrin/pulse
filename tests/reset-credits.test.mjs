import test from 'node:test';
import assert from 'node:assert/strict';
import { bankedResets } from '../reset-credits.mjs';
import { normalizeCodexAccount, stabilizeCodexAccount } from '../server.mjs';
import { normalizeClaudeUsage, markClaudeUsageStale } from '../claude-usage.mjs';
import { createClaudeUsageMonitor } from '../claude-cache.mjs';

test('Codex uses the top-level reset-credit count, including zero and capped detail lists', () => {
  for (const count of [0, 1, 8]) {
    const account = normalizeCodexAccount({ id: `reset-${count}`, profile: 'Work' }, { rate: {
      rateLimits: { primary: { remainingPercent: 0 } },
      rateLimitResetCredits: { availableCount: count, credits: [] }
    } });
    assert.equal(account.bankedResets, count);
    assert.equal(account.windows[0].remainingPercent, 0, 'banked resets do not refill a quota');
    stabilizeCodexAccount(account);
    const cached = stabilizeCodexAccount(normalizeCodexAccount({ id: account.id }, null));
    assert.equal(cached.bankedResets, count);
    assert.equal(cached.rateStale, true);
  }
});

test('missing and malformed reset metadata remain unknown, and usage credits are separate', () => {
  for (const value of [null, undefined, true, false, -1, 1.5, '', ' ', 'unlimited', {}, Infinity]) {
    assert.equal(bankedResets({ bankedResets: value }), null);
  }
  assert.equal(bankedResets({ credits: { balance: 50, hasCredits: true } }), null);
  assert.equal(bankedResets({ rateLimitResetCredits: { availableCount: 2, credits: [{}, {}, {}, {}] } }), 2);
});

test('a provider-reported reset balance is retained even if quota windows are absent', async () => {
  const codex = stabilizeCodexAccount(normalizeCodexAccount({ id: 'balance-only' }, { rate: { rateLimitResetCredits: { availableCount: 2 } } }));
  assert.equal(codex.bankedResets, 2);
  assert.equal(codex.connected, true);
  assert.equal(codex.windows.length, 0);
  const subscription = { connected: true, plan: 'Pro', planSource: 'providerReported' };
  const read = createClaudeUsageMonitor({ collect: async () => ({ payload: { bankedResets: 2 } }) });
  const claude = await read(subscription);
  assert.equal(claude.bankedResets, 2);
  assert.ok(claude.fetchedAt);
  assert.equal(claude.unreported, true, 'a reset balance does not supply quota headroom');
});

test('Claude preserves reported reset balances through stale cache and never invents an unsupported balance', async () => {
  const now = Date.now();
  const payload = { banked_resets: 3, rate_limits: { five_hour: { utilization: 100, resets_at: new Date(now + 3600000).toISOString() } } };
  const subscription = { connected: true, plan: 'Pro', planSource: 'providerReported' };
  const current = normalizeClaudeUsage(payload, { now, subscription });
  assert.equal(current.bankedResets, 3);
  assert.equal(markClaudeUsageStale(current, { now: now + 1000 }).bankedResets, 3);
  assert.equal(normalizeClaudeUsage({ rate_limits: payload.rate_limits }, { now }).bankedResets, null);
  const monitor = createClaudeUsageMonitor({ load: async () => ({ version: 1, snapshot: current }), collect: async () => ({ reason: 'rate_limit' }), clock: () => now + 1000 });
  const cached = await monitor(subscription);
  assert.equal(cached.bankedResets, 3);
  assert.equal(cached.stale, true);
});

test('new Claude provider meter rows map session and weekly allowance by kind', () => {
  const future = new Date(Date.now() + 3600000).toISOString();
  const result = normalizeClaudeUsage({ rate_limits: { limits: [
    { kind: 'session', percent: 42, resets_at: future },
    { kind: 'weekly_all', percent: 0, resets_at: future },
    { kind: 'weekly_scoped', percent: 100, resets_at: future }
  ] } });
  assert.deepEqual(result.limits.map(window => [window.tag, window.remaining]), [['5H', 58], ['7D', 100]]);
});
