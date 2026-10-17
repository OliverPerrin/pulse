import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import { server, normalizeCodexAccount } from '../server.mjs';

test('static serving exposes app assets but not repository files', async t => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js', '/app-theme.css', '/dashboard-insights.css', '/marketing/', '/marketing/app.js', '/marketing/assets/pulse-icon.png']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
  for (const path of ['/.git/config', '/.env', '/package.json', '/server.mjs', '/README.md', '/node_modules/electron/package.json', '/marketing/../.git/config']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found');
  }
  for (const headers of [
    { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }
  ]) {
    const response = await fetch(base + '/api/providers', { method: 'POST', headers, body: '{"type":"complete"}' });
    assert.equal(response.status, 403, JSON.stringify(headers));
    await response.text();
  }
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/api/providers', { method: 'POST', headers: { Host: 'untrusted.example', 'Content-Type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end('{"type":"complete"}');
  });
  assert.equal(hostStatus, 403);
});

test('an account without a reported or configured plan stays unknown', () => {
  const account = normalizeCodexAccount({ id: 'new-user', profile: '.codex' }, null);
  assert.equal(account.plan, undefined);
  assert.equal(account.planSource, 'unreported');
  assert.deepEqual(account.windows, []);
});
