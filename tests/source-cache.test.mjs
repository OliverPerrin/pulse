import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, appendFile, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJsonFileReader, createTranscriptScanner, projectCodexUsageRecord, projectClaudeUsageRecord } from '../server.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pulse-sources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'session.jsonl');
}
const markers = [Buffer.from('usage')];
const project = record => record.usage ? { usage: record.usage } : null;
const line = usage => JSON.stringify({ usage, content: 'conversation should not enter the cache' }) + '\n';
const collect = async (scanner, filePath, suppliedMarkers = markers, projection = project) => {
  const records = [];
  const used = await scanner(filePath, suppliedMarkers, record => { records.push(record); return true; }, projection);
  return { records, used };
};

// Count actual disk reads, not timings, so performance regressions are stable
// even on slow CI hosts.
test('unchanged JSON sources share parsing across concurrent ranges and invalidate immediately', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, JSON.stringify({ tokens: 10 }));
  let reads = 0;
  const read = createJsonFileReader({ readFile: (...args) => { reads++; return readFile(...args); } });
  const values = await Promise.all([read(filePath), read(filePath), read(filePath)]);
  assert.equal(reads, 1);
  assert.deepEqual(values, [{ tokens: 10 }, { tokens: 10 }, { tokens: 10 }]);
  await writeFile(filePath, JSON.stringify({ tokens: 20 }));
  assert.deepEqual(await read(filePath), { tokens: 20 });
  assert.equal(reads, 2);
  await writeFile(filePath, '{partial');
  assert.deepEqual(await Promise.all([read(filePath), read(filePath)]), [null, null]);
  await writeFile(filePath, JSON.stringify({ tokens: 30 }));
  assert.deepEqual(await read(filePath), { tokens: 30 });
  await rm(filePath);
  assert.equal(await read(filePath), null);
});

test('stable transcript scans replay compact usage and refresh for append, rewrite and missing files', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, line(10));
  let reads = 0;
  const scan = createTranscriptScanner({ readStream: (...args) => { reads++; return createReadStream(...args); } });
  assert.deepEqual(await collect(scan, filePath), { records: [{ usage: 10 }], used: true });
  assert.deepEqual(await collect(scan, filePath), { records: [{ usage: 10 }], used: true });
  assert.equal(reads, 1);
  await appendFile(filePath, line(20));
  assert.deepEqual((await collect(scan, filePath)).records, [{ usage: 10 }, { usage: 20 }]);
  await writeFile(filePath, line(30));
  assert.deepEqual((await collect(scan, filePath)).records, [{ usage: 30 }]);
  assert.equal(reads, 3);
  await rm(filePath);
  assert.deepEqual(await collect(scan, filePath), { records: [], used: false });
});

test('partial final records are recovered on append and UTF-8 lines survive stream boundaries', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, line('日本語') + '{"usage":2');
  const scan = createTranscriptScanner({ readStream: file => createReadStream(file, { highWaterMark: 7 }) });
  assert.deepEqual((await collect(scan, filePath)).records, [{ usage: '日本語' }]);
  await appendFile(filePath, '0}');
  assert.deepEqual((await collect(scan, filePath)).records, [{ usage: '日本語' }, { usage: 20 }]);
});

test('transcript cache limits and marker sets never change the selected records', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, line(10) + JSON.stringify({ model: 'other', usage: 20 }) + '\n');
  let reads = 0;
  const readStream = (...args) => { reads++; return createReadStream(...args); };
  const scan = createTranscriptScanner({ readStream, maxCacheBytes: 1 });
  await collect(scan, filePath);
  await collect(scan, filePath);
  assert.equal(reads, 2, 'oversized entries do not accumulate in the cache');
  const bounded = createTranscriptScanner({ readStream, maxEntries: 1 });
  assert.equal((await collect(bounded, filePath)).records.length, 2);
  assert.deepEqual((await collect(bounded, filePath, [Buffer.from('model')])).records, [{ usage: 20 }]);
  assert.equal((await collect(bounded, filePath)).records.length, 2);
  assert.equal(reads, 5, 'the older marker entry was evicted');
});

test('a transcript changing during a scan is never reused as a stable snapshot', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, line(10));
  let reads = 0, stats = 0;
  const scan = createTranscriptScanner({
    readStream: (...args) => { reads++; return createReadStream(...args); },
    stat: async file => {
      const value = await stat(file);
      if (++stats === 2) return { ...value, size: value.size + 1 };
      return value;
    }
  });
  await collect(scan, filePath);
  await collect(scan, filePath);
  assert.equal(reads, 2);
});

test('unreadable transcripts are retried rather than cached as empty usage', async t => {
  const filePath = await fixture(t);
  await writeFile(filePath, line(10));
  let reads = 0;
  const scan = createTranscriptScanner({ readStream: (...args) => {
    if (++reads === 1) throw new Error('temporary read failure');
    return createReadStream(...args);
  } });
  assert.deepEqual(await collect(scan, filePath), { records: [], used: false });
  assert.deepEqual((await collect(scan, filePath)).records, [{ usage: 10 }]);
  assert.equal(reads, 2);
});

test('provider projections preserve attribution, deduplication and quota fields without conversation content', () => {
  assert.deepEqual(projectCodexUsageRecord({ type: 'session_meta', payload: { id: 'session', instructions: 'private' } }), { type: 'session_meta', payload: { id: 'session' } });
  assert.deepEqual(projectCodexUsageRecord({ type: 'turn_context', payload: { model: 'model', instructions: 'private' } }), { type: 'turn_context', payload: { model: 'model' } });
  const codex = { type: 'token_usage_record', timestamp: 'today', payload: { response_id: 'reply', usage: { input_tokens: 10 }, content: 'private' } };
  assert.deepEqual(projectCodexUsageRecord(codex), { type: codex.type, timestamp: codex.timestamp, payload: { response_id: 'reply', usage: codex.payload.usage } });
  const claude = { type: 'assistant', timestamp: 'today', uuid: 'reply', sessionId: 'session', model: 'model', quotaLimits: { status: 'rejected' }, message: { id: 'reply', model: 'model', usage: { input_tokens: 10 }, content: 'private' } };
  assert.deepEqual(projectClaudeUsageRecord(claude), { ...claude, message: { id: 'reply', model: 'model', usage: { input_tokens: 10 } } });
  assert.equal(projectClaudeUsageRecord({ type: 'user', message: { content: 'usage' } }), null);
});
