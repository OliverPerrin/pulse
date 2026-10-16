import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { server, normalizeCodexAccount } from '../server.mjs';

test('static serving exposes app assets but not repository files', async t => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js', '/dashboard-insights.css', '/marketing/', '/marketing/app.js', '/marketing/assets/pulse-icon.png']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
  for (const path of ['/.git/config', '/.env', '/package.json', '/server.mjs', '/README.md', '/node_modules/electron/package.json', '/marketing/../.git/config']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found');
  }
});

test('an account without a reported or configured plan stays unknown', () => {
  const account = normalizeCodexAccount({ id: 'new-user', profile: '.codex' }, null);
  assert.equal(account.plan, undefined);
  assert.equal(account.planSource, 'unreported');
  assert.deepEqual(account.windows, []);
});
