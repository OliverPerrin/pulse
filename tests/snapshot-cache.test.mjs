import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotReader } from '../snapshot-cache.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('first loads collapse; expired history returns immediately while one refresh runs', async () => {
  let now = 0, calls = 0, finish;
  const read = createSnapshotReader({ clock: () => now, ttlMs: 100, load: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = read('30'), second = read('30');
  await tick(); assert.equal(calls, 1);
  finish({ fetchedAt: 1, cost: 7 });
  assert.equal((await first).cost, 7); await second;
  now = 101;
  assert.deepEqual(await read('30'), { fetchedAt: 1, cost: 7, refreshing: true });
  assert.equal((await read('30')).cost, 7);
  await tick(); assert.equal(calls, 2);
  finish({ fetchedAt: 2, cost: 8 }); await tick();
  assert.deepEqual(await read('30'), { fetchedAt: 2, cost: 8, refreshing: false });
});

test('failed background refresh retains its timestamp and marks history stale', async () => {
  let now = 0, fail = false;
  const read = createSnapshotReader({ clock: () => now, ttlMs: 100, load: async () => { if (fail) throw Error('offline'); return { fetchedAt: 7 }; } });
  await read('7'); now = 101; fail = true;
  await read('7'); await tick();
  assert.deepEqual(await read('7'), { fetchedAt: 7, refreshing: false, historyStale: true });
});

test('configuration invalidation prevents an older in-flight snapshot from being reused', async () => {
  let finish, calls = 0;
  const read = createSnapshotReader({ load: () => { calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : { fetchedAt: 2 }; } });
  const old = read('30'); await tick(); read.clear();
  assert.equal((await read('30')).fetchedAt, 2);
  finish({ fetchedAt: 1 }); await old;
  assert.equal((await read('30')).fetchedAt, 2);
});
