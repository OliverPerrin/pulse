import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeUsageMonitor } from '../claude-cache.mjs';
import { normalizeClaudeUsage } from '../claude-usage.mjs';

const start = Date.parse('2026-09-30T01:00:00Z');
const sub = { connected:true,plan:'Pro',planSource:'providerReported',subscriptionFetchedAt:start };
const payload = { rate_limits:{ five_hour:{utilization:47,resets_at:'2026-09-30T05:30:00Z'},seven_day:{utilization:4,resets_at:'2026-10-04T21:00:00Z'} } };

test('live allowance fetches collapse and refresh independently of historical range', async () => {
  let calls=0,loads=0,now=start,resolve;
  const read=createClaudeUsageMonitor({load:async()=>{loads++;return null},collect:()=>{calls++;return new Promise(r=>resolve=r)},clock:()=>now});
  const a=read(sub),b=read(sub);await new Promise(r=>setImmediate(r));resolve({payload});
  const results=await Promise.all([a,b]);assert.equal(calls,1);assert.equal(loads,1);assert.equal(results[0].limits[0].remaining,53);
  now+=30000;assert.equal((await read(sub)).stale,false);assert.equal(calls,1);
});

test('provider cooldown survives restart and preserves verified web snapshot with honest provenance', async () => {
  let calls=0,now=start,saved;
  const snapshot=normalizeClaudeUsage(payload,{subscription:sub,now,source:'claude_web'});
  const read=createClaudeUsageMonitor({load:async()=>({version:1,snapshot}),save:async v=>saved=v,clock:()=>now,collect:async()=>{calls++;return {reason:'rate_limit',retryAfterSeconds:1200}}});
  const first=await read(sub);assert.equal(calls,1);assert.equal(first.stale,true);assert.equal(first.source,'claude_web');assert.equal(first.limits[0].remaining,53);assert.equal(first.nextRetryAt,start+1200000);
  const restarted=createClaudeUsageMonitor({load:async()=>saved,clock:()=>now,collect:async()=>{calls++;return {payload}}});
  now+=100000;assert.equal((await restarted(sub)).limits[1].remaining,96);assert.equal(calls,1);
  now=start+1200001;const fresh=await restarted(sub);assert.equal(calls,2);assert.equal(fresh.stale,false);assert.equal(fresh.source,'claude_code');
});

test('elapsed windows are unknown during cooldown, while an active weekly window is retained', async () => {
  let now=start;const snapshot=normalizeClaudeUsage(payload,{subscription:sub,now,source:'claude_web'});
  const read=createClaudeUsageMonitor({load:async()=>({version:1,snapshot,retryAt:start+8*3600000,reason:'rate_limit'}),clock:()=>now,collect:async()=>{throw Error('should not call')}});
  now=Date.parse('2026-09-30T06:00:00Z');const result=await read(sub);assert.equal(result.limits[0].remaining,null);assert.equal(result.limits[1].remaining,96);assert.equal(result.fetchedAt,start);
});

test('old cache, missing auth and failed fetches never fabricate full allowance', async () => {
  const snapshot=normalizeClaudeUsage(payload,{subscription:sub,now:start-2*86400000});let calls=0;
  const read=createClaudeUsageMonitor({load:async()=>({version:1,snapshot}),clock:()=>start,collect:async()=>{calls++;throw Error('private diagnostic')}});
  const result=await read(sub);assert.equal(result.limits,undefined);assert.equal(result.unreported,true);assert(!JSON.stringify(result).includes('private diagnostic'));
  const loggedOut=await read({...sub,connected:false,plan:'Not reported',planSource:'unreported'});assert.equal(loggedOut.limits,undefined);assert.equal(calls,1);
});

test('a transient auth-status failure preserves verified allowance and provider cooldown', async () => {
  let calls=0,now=start;
  const snapshot=normalizeClaudeUsage(payload,{subscription:sub,now,source:'claude_web'});
  const read=createClaudeUsageMonitor({load:async()=>({version:1,snapshot,retryAt:start+900000,reason:'rate_limit'}),clock:()=>now,collect:async()=>{calls++;return {payload}}});
  const unknown=await read({connected:false,authStatusKnown:false,plan:'Not reported',planSource:'unreported'});
  assert.equal(unknown.limits[0].remaining,53);assert.equal(unknown.stale,true);assert.equal(unknown.nextRetryAt,start+900000);
  now+=100000;assert.equal((await read(sub)).limits[1].remaining,96);assert.equal(calls,0);
  const logout=await read({connected:false,authStatusKnown:true,plan:'Not reported',planSource:'unreported'});assert.equal(logout.limits,undefined);
  await read(sub);assert.equal(calls,1);
});

test('peek returns cached reset evidence without starting a provider probe', async () => {
  let calls = 0;
  const snapshot = normalizeClaudeUsage({ ...payload, bankedResets: 2 }, { now: start, subscription: sub });
  const read = createClaudeUsageMonitor({ load: async () => ({ version: 1, snapshot }), clock: () => start + 1000, collect: async () => { calls++; return {}; } });
  const cached = await read.peek();
  assert.equal(cached.bankedResets, 2);
  assert.equal(cached.fetchedAt, start);
  assert.equal(cached.stale, true);
  assert.equal(calls, 0);
});
