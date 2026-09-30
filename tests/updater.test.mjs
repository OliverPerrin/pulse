import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, atomicJson, installPreparedBundle, readJson, recoverTransaction, retryDelay, validateSmoke } from '../scripts/local-updater.mjs';

const candidate = { commit: 'a'.repeat(40), version: '0.1.5', archiveSha256: 'new-hash' };
async function fixture(t, { running = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-updater-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const p = Object.fromEntries(['target', 'staged', 'backup', 'failed', 'journal', 'receipt'].map(key => [key, path.join(directory, key)]));
  for (const key of ['target', 'staged']) { await fs.mkdir(p[key]); await fs.writeFile(path.join(p[key], 'build'), key === 'target' ? 'old' : 'new'); }
  await atomicJson(p.receipt, { commit: 'old', archiveSha256: 'old-hash' });
  const events = [];
  const ops = {
    verify: async target => { events.push(`verify:${path.basename(target)}`); },
    smoke: async target => { events.push(`smoke:${path.basename(target)}`); },
    isRunning: async () => running,
    stop: async () => { events.push('stop'); },
    launch: async (_target, build) => { events.push(build ? 'launch:new' : 'launch:old'); }
  };
  return { p, ops, events, directory };
}
const buildAt = target => fs.readFile(path.join(target, 'build'), 'utf8');

test('a verified update preserves the previous bundle and reopens a running app', async t => {
  const { p, ops, events } = await fixture(t);
  await installPreparedBundle(p, candidate, ops);
  assert.equal(await buildAt(p.target), 'new');
  assert.equal(await buildAt(p.backup), 'old');
  assert.equal((await readJson(p.receipt)).commit, candidate.commit);
  assert.equal(await readJson(p.journal), null);
  assert.deepEqual(events, ['verify:staged', 'smoke:staged', 'verify:target', 'stop', 'verify:target', 'smoke:target', 'launch:new']);
});

test('updating a closed app does not start it in the normal profile', async t => {
  const { p, ops, events } = await fixture(t, { running: false });
  await installPreparedBundle(p, candidate, ops);
  assert.equal(await buildAt(p.target), 'new');
  assert(!events.some(event => event.startsWith('launch') || event === 'stop'));
});

test('failed preflight and superseded commits never stop or replace the running app', async t => {
  for (const failure of ['verify', 'smoke', 'beforeSwap']) {
    const { p, ops, events } = await fixture(t);
    ops[failure] = async () => { throw new Error(failure); };
    await assert.rejects(installPreparedBundle(p, candidate, ops), new RegExp(failure));
    assert.equal(await buildAt(p.target), 'old');
    assert.equal((await readJson(p.receipt)).commit, 'old');
    assert.equal(await readJson(p.journal), null);
    assert(!events.includes('stop'));
  }
});

test('a failing installed smoke test restores both bundle and receipt', async t => {
  const { p, ops, events } = await fixture(t);
  ops.smoke = async target => { if (target === p.target) throw new Error('installed smoke failed'); };
  await assert.rejects(installPreparedBundle(p, candidate, ops), /installed smoke failed/);
  assert.equal(await buildAt(p.target), 'old');
  assert.equal(await buildAt(p.failed), 'new');
  assert.equal((await readJson(p.receipt)).commit, 'old');
  assert.equal(events.at(-1), 'launch:old');
  assert.equal(await readJson(p.journal), null);
});

test('failure to load the real profile rolls back and reopens the old app', async t => {
  const { p, ops, events } = await fixture(t);
  ops.launch = async (_target, build) => { if (build) throw new Error('no live dashboard'); events.push('launch:old'); };
  await assert.rejects(installPreparedBundle(p, candidate, ops), /no live dashboard/);
  assert.equal(await buildAt(p.target), 'old');
  assert.equal((await readJson(p.receipt)).commit, 'old');
  assert.equal(events.at(-1), 'launch:old');
});

test('an interrupted swap is recoverable even between the two renames', async t => {
  const { p, ops, events } = await fixture(t);
  await atomicJson(p.journal, { hadTarget: true, wasRunning: true, previousReceipt: await readJson(p.receipt) });
  await fs.rename(p.target, p.backup);
  await recoverTransaction(p, ops);
  assert.equal(await buildAt(p.target), 'old');
  assert.equal(events.at(-1), 'launch:old');
  assert.equal(await readJson(p.journal), null);
});

test('failed first installation does not leave a broken new app installed', async t => {
  const { p, ops } = await fixture(t, { running: false });
  await fs.rm(p.target, { recursive: true }); await fs.rm(p.receipt);
  ops.smoke = async target => { if (target === p.target) throw new Error('broken'); };
  await assert.rejects(installPreparedBundle(p, candidate, ops), /broken/);
  await assert.rejects(fs.stat(p.target), { code: 'ENOENT' });
  assert.equal(await readJson(p.receipt), null);
  assert.equal(await buildAt(p.failed), 'new');
});

test('the lock excludes concurrent checks and is released by its owner', async t => {
  const { directory } = await fixture(t);
  const lock = path.join(directory, 'lock');
  const release = await acquireLock(lock);
  assert.equal(await acquireLock(lock), null);
  await release();
  const next = await acquireLock(lock);
  assert.equal(typeof next, 'function'); await next();
});

test('smoke result parsing rejects false and missing checks even with exit code zero', () => {
  assert.throws(() => validateSmoke('nothing'), /did not report/);
  const checks = { apiSnapshotValid: true, dashboardImagesLoaded: true, mainLoaded: true, trayLoaded: true, rendererSandboxed: true, liveSnapshotReady: true };
  assert.doesNotThrow(() => validateSmoke(`PULSE_SMOKE ${JSON.stringify(checks)}`));
  assert.throws(() => validateSmoke(`PULSE_SMOKE ${JSON.stringify({ ...checks, liveSnapshotReady: false })}`), /liveSnapshotReady/);
  assert.throws(() => validateSmoke(`PULSE_SMOKE ${JSON.stringify({ ...checks, anotherCheck: false })}`), /smoke check failed/);
});

test('failed commits back off without an unbounded retry interval', () => {
  assert.equal(retryDelay(1), 60000); assert.equal(retryDelay(3), 240000); assert.equal(retryDelay(100), 3600000);
});
