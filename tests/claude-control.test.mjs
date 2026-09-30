import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readClaudeUsage } from '../claude-control.mjs';

function fixture(handle) {
  const requests = [];
  const signals = [];
  let invocation;
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = (signal) => {
    signals.push(signal);
    child.signalCode = signal;
    queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  let input = '';
  child.stdin.on('data', (chunk) => {
    input += chunk.toString();
    let newline;
    while ((newline = input.indexOf('\n')) !== -1) {
      const request = JSON.parse(input.slice(0, newline));
      input = input.slice(newline + 1);
      requests.push(request);
      queueMicrotask(() => handle(request, child));
    }
  });
  const spawnImpl = (...args) => { invocation = args; return child; };
  return { spawnImpl, requests, signals, child, get invocation() { return invocation; } };
}

function reply(child, request, response, subtype = 'success') {
  child.stdout.write(`${JSON.stringify({ type: 'control_response', response: { request_id: request.request_id, subtype, ...subtype === 'success' ? { response } : { error: response } } })}\n`);
}

test('usage control handshake sends no model prompt and exposes only allowlisted provider quota', async () => {
  const f = fixture((request, child) => {
    if (request.request.subtype === 'initialize') reply(child, request, {});
    else reply(child, request, {
      subscription_type: 'pro', email: 'private@example.com', accessToken: 'private-token', session: { secret: true },
      rate_limits: { five_hour: { utilization: 47, resets_at: '2026-09-30T05:29:59Z', hidden: 'private' }, seven_day: { utilization: 4, resets_at: '2026-10-04T20:59:59Z' }, extra_usage: { private: true } }
    });
  });
  const result = await readClaudeUsage({ spawnImpl: f.spawnImpl, cwd: '/tmp', timeoutMs: 100 });
  assert.deepEqual(result, { payload: { rate_limits: { five_hour: { utilization: 47, resets_at: '2026-09-30T05:29:59Z' }, seven_day: { utilization: 4, resets_at: '2026-10-04T20:59:59Z' } }, subscription_type: 'pro' }, reason: null, retryAfterSeconds: null });
  assert.deepEqual(f.requests.map((request) => request.request), [{ subtype: 'initialize' }, { subtype: 'get_usage', skip_behaviors: true }]);
  assert.ok(f.invocation[1].includes('--no-session-persistence'));
  assert.ok(f.invocation[1].includes('--safe-mode'));
  assert.equal(f.invocation[2].cwd, '/tmp');
  assert.deepEqual(f.signals, ['SIGTERM']);
});

test('provider cooldown is parsed without returning any raw diagnostics or control fields', async () => {
  const f = fixture((request, child) => {
    if (request.request.subtype === 'initialize') reply(child, request, {});
    else {
      child.stderr.write('secret-token must never leave collector\nfetchUtilization: 429 remembered for this bearer; not asking again for 1336s\n');
      reply(child, request, { rate_limits_available: true, rate_limits: null });
    }
  });
  assert.deepEqual(await readClaudeUsage({ spawnImpl: f.spawnImpl }), { payload: null, reason: 'rate_limit', retryAfterSeconds: 1336 });
});

test('control errors and unavailable authentication are safe reason codes', async () => {
  for (const [error, expected] of [['Not signed in; private@example.com', 'auth_required'], ['Unsupported get_usage; secret-token', 'unavailable']]) {
    const f = fixture((request, child) => reply(child, request, error, 'error'));
    assert.deepEqual(await readClaudeUsage({ spawnImpl: f.spawnImpl }), { payload: null, reason: expected, retryAfterSeconds: null });
    assert.equal(f.requests.length, 1);
  }
});

test('malformed output, mismatched request IDs and unrelated content cannot provide a quota', async () => {
  const f = fixture((request, child) => {
    child.stdout.write('invalid-json\n');
    child.stdout.write(JSON.stringify({ type: 'control_response', response: { request_id: 'other', subtype: 'success', response: { rate_limits: {} } } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'assistant', message: 'private content' }) + '\n');
  });
  assert.deepEqual(await readClaudeUsage({ spawnImpl: f.spawnImpl, timeoutMs: 15 }), { payload: null, reason: 'timeout', retryAfterSeconds: null });
  assert.deepEqual(f.signals, ['SIGTERM']);
});

test('invalid quota values are rejected and missing provider windows stay missing', async () => {
  const f = fixture((request, child) => reply(child, request, request.request.subtype === 'initialize' ? {} : {
    rate_limits: { five_hour: { utilization: '47', resets_at: 'private-token' }, seven_day: { utilization: 0, resets_at: null } }, subscription_type: 'untrusted-plan'
  }));
  assert.deepEqual(await readClaudeUsage({ spawnImpl: f.spawnImpl }), { payload: { rate_limits: { seven_day: { utilization: 0, resets_at: null } } }, reason: null, retryAfterSeconds: null });
});

test('spawn and early process failures resolve unavailable without leaking errors', async () => {
  assert.deepEqual(await readClaudeUsage({ spawnImpl() { throw Error('secret-token'); } }), { payload: null, reason: 'unavailable', retryAfterSeconds: null });
  const f = fixture((request, child) => { child.exitCode = 1; child.emit('close', 1); });
  assert.deepEqual(await readClaudeUsage({ spawnImpl: f.spawnImpl }), { payload: null, reason: 'unavailable', retryAfterSeconds: null });
});
