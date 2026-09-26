import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { claudeLimitsFromQuota, normalizeCodexAccount, rateLimitWindow, stabilizeCodexAccount } from '../server.mjs';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const desktopSource = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const futureReset = () => Math.floor(Date.now() / 1000) + 3600;
const accountFixture = (id, windows = []) => ({
  id, profile: id, plan: 'plus', planSource: 'providerReported', connected: true,
  exact: true, rateFetchedAt: Date.now(), usageExact: true, usageFetchedAt: Date.now(),
  dailyUsage: [], lifetimeTokens: 0, windows
});

test('packaged Codex probes use a real directory and contain synchronous launch failures', async () => {
  let options;
  const context = vm.createContext({
    process: { env: {} }, homeDir: '/Users/test',
    __dirname: '/Applications/Pulse.app/Contents/Resources/app.asar',
    normalizeCodexAccount,
    spawn: (_command, _args, suppliedOptions) => {
      options = suppliedOptions;
      throw Object.assign(new Error('spawn ENOTDIR'), { code: 'ENOTDIR' });
    }
  });
  vm.runInContext(serverSource.slice(serverSource.indexOf('function readCodexRateLimits('), serverSource.indexOf('async function readCodexAccounts(')), context);
  const readAccount = vm.runInContext('readCodexRateLimits', context);
  const result = await readAccount({ id: 'missing', profile: '.missing', home: '/Users/test/.codex', fallbackPlan: 'plus' });
  assert.equal(options.cwd, '/Users/test');
  assert.equal(options.env.CODEX_HOME, '/Users/test/.codex');
  assert.equal(result.connected, false);
  assert.deepEqual(result.windows, []);
});

function loadDashboard(accounts = [], { tray = false } = {}) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelectorAll: () => []
    });
    return nodes.get(selector);
  };
  const payloads = [];
  const context = vm.createContext({
    window: { location: { search: tray ? '?surface=tray' : '' }, pulseDesktop: { reportTrayStatus: (payload) => payloads.push(payload) } },
    document: { body: node('body'), querySelector: node, querySelectorAll: () => [] },
    URLSearchParams, Intl, Date, console,
    localStorage: { getItem: () => null, setItem() {} }
  });
  // Evaluate the actual renderer without starting network polling or attaching
  // browser listeners. The public rendering functions still use a tiny DOM.
  const bootstrap = appSource.lastIndexOf('\nhydrateIcons();');
  assert.ok(bootstrap > 0, 'renderer bootstrap is identifiable');
  vm.runInContext(appSource.slice(0, bootstrap), context);
  const dashboard = vm.runInContext('({ state, currentHeadroom, currentAccountLimits, accountAvailability, notificationItems, displayPercent, formatResetDate, resetLabel, dailyTokenValue, chartValue, renderCodexAccounts, renderCompactView, reportTrayStatus, providerLimits, currentDaily, syncUsage })', context);
  const initialSnapshot = dashboard.state.snapshot;
  dashboard.state.snapshot = {
    fetchedAt: Date.now(), mode: 'local', providers: [], codexAccounts: accounts, limits: {}, daily: [],
    summary: { totalCost: 0, totalTokens: 0, processedTokens: 0, cachedInput: 0, uncachedInput: 0, output: 0, cacheSavings: 0 }
  };
  return { ...dashboard, nodes, payloads, context, initialSnapshot };
}

function loadSyncDashboard() {
  const dashboard = loadDashboard();
  const requests = [];
  const rendered = [];
  dashboard.context.fetch = (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
  dashboard.context.captureRender = (snapshot, range) => rendered.push({ snapshot, range });
  vm.runInContext(`
    renderAll = () => captureRender(state.snapshot, state.range);
    setSyncing = (value) => { state.syncing = value; };
    updateSyncLabels = () => {};
    showToast = () => {};
  `, dashboard.context);
  dashboard.state.snapshot.rangeDays = 30;
  dashboard.state.snapshot.rangeKey = 30;
  return { ...dashboard, requests, rendered };
}

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function loadDesktop() {
  const handlers = new Map();
  const presentation = {};
  const context = vm.createContext({
    baseUrl: 'http://127.0.0.1:5188', isMac: true,
    trayStatus: { lowestRemaining: null, accounts: [], warningCount: 0, paused: false },
    tray: { setTitle: (value) => { presentation.title = value; }, setToolTip: (value) => { presentation.tooltip = value; } },
    ipcMain: { on: (event, handler) => handlers.set(event, handler) },
    Menu: { buildFromTemplate: (items) => items },
    app: { getLoginItemSettings: () => ({ openAtLogin: false }) }
  });
  vm.runInContext(desktopSource.slice(desktopSource.indexOf('function safePercent('), desktopSource.indexOf('function createTray(')), context);
  vm.runInContext(desktopSource.slice(desktopSource.indexOf('function registerIpc('), desktopSource.indexOf('function createApplicationMenu(')), context);
  vm.runInContext('registerIpc()', context);
  return { context, handlers, presentation };
}

test('quota normalization distinguishes missing allowance, exhaustion, and a positive fraction', () => {
  for (const value of [null, undefined, '', ' ', false, 'unknown']) {
    const window = rateLimitWindow({ windowDurationMins: 300, remainingPercent: value });
    assert.equal(window.remainingPercent, null);
    assert.equal(window.usedPercent, null);
    assert.equal(window.reported, false);
  }
  assert.equal(rateLimitWindow({ usedPercent: 100 }).remainingPercent, 0);
  assert.equal(rateLimitWindow({ remainingPercent: 0, usedPercent: 10 }).remainingPercent, 0);
  assert.equal(rateLimitWindow({ remainingPercent: 0.2, usedPercent: 100 }).remainingPercent, 0.2);
});

test('an unavailable provider does not fabricate a full quota window', () => {
  const account = normalizeCodexAccount({ id: 'missing', profile: '.missing', fallbackPlan: 'plus' }, null);
  assert.equal(account.connected, false);
  assert.equal(account.planSource, 'fallback');
  assert.deepEqual(account.windows, []);
});

test('crossing a reset makes the previous percentage historical', () => {
  const oldWindow = rateLimitWindow({ windowDurationMins: 300, remainingPercent: 0, resetsAt: Math.floor(Date.now() / 1000) - 1 });
  const result = stabilizeCodexAccount(accountFixture('reset-expired-test', [oldWindow]));
  assert.equal(result.windows[0].status, 'reset_pending');
  assert.equal(result.windows[0].remainingPercent, null);
  assert.equal(result.windows[0].lastKnownRemainingPercent, 0);
  assert.equal(result.windows[0].reported, false);
  assert.equal(oldWindow.remainingPercent, 0, 'source snapshot is not mutated');
});

test('a transient fetch failure preserves recent quota and usage with cached labels', () => {
  const id = 'recent-cache-test';
  const original = accountFixture(id, [rateLimitWindow({ remainingPercent: 37, resetsAt: futureReset() })]);
  stabilizeCodexAccount(original);
  const unavailable = normalizeCodexAccount({ id, profile: id, fallbackPlan: 'free' }, null);
  const result = stabilizeCodexAccount(unavailable);
  assert.equal(result.windows[0].remainingPercent, 37);
  assert.equal(result.windows[0].status, 'cached');
  assert.equal(result.rateStale, true);
  assert.equal(result.usageStale, true);
  assert.equal(result.plan, 'plus');
});

test('fresh usage does not keep an expired rate cache alive, or vice versa', () => {
  const expired = Date.now() - 25 * 60 * 60 * 1000;
  const staleRateId = 'old-rate-cache-test';
  stabilizeCodexAccount({ ...accountFixture(staleRateId, [rateLimitWindow({ remainingPercent: 75 })]), rateFetchedAt: expired });
  const rateResult = stabilizeCodexAccount(normalizeCodexAccount({ id: staleRateId, profile: staleRateId }, null));
  assert.deepEqual(rateResult.windows, []);
  assert.equal(rateResult.rateStale, false);
  assert.equal(rateResult.usageStale, true);

  const staleUsageId = 'old-usage-cache-test';
  stabilizeCodexAccount({ ...accountFixture(staleUsageId, [rateLimitWindow({ remainingPercent: 75 })]), usageFetchedAt: expired });
  const usageResult = stabilizeCodexAccount(normalizeCodexAccount({ id: staleUsageId, profile: staleUsageId }, null));
  assert.equal(usageResult.windows[0].remainingPercent, 75);
  assert.equal(usageResult.rateStale, true);
  assert.equal(usageResult.usageStale, false);
});

test('Claude rejection proves zero only for a current, recognized quota window', () => {
  for (const rateLimitType of ['five_hour', 'seven_day', 'weekly']) {
    const result = claudeLimitsFromQuota({ overageStatus: 'rejected', rateLimitType, resetsAt: futureReset(), fetchedAt: Date.now() });
    assert.equal(result.limits[0].remaining, 0);
    assert.equal(result.planSource, 'unreported');
  }
  for (const quota of [
    { status: 'allowed', rateLimitType: 'five_hour', resetsAt: futureReset() },
    { status: 'rejected', rateLimitType: 'unknown', resetsAt: futureReset() },
    { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) - 1 },
    { status: 'rejected', rateLimitType: 'five_hour', fetchedAt: Date.now() - 6 * 60 * 60 * 1000 }
  ]) {
    const result = claudeLimitsFromQuota(quota);
    assert.equal(result.unreported, true);
    assert.equal(result.limits, undefined);
  }
});

test('unknown and elapsed windows never become depleted alerts or tray minima', () => {
  const dashboard = loadDashboard([accountFixture('uncertain', [
    { tag: '5H', label: '5 hour window', remainingPercent: null, resetsAt: futureReset() },
    { tag: '7D', label: 'Weekly window', remainingPercent: 0, resetsAt: Math.floor(Date.now() / 1000) - 1 }
  ])], { tray: true });
  assert.equal(dashboard.currentHeadroom().length, 0);
  assert.equal(dashboard.notificationItems().filter((item) => item.level !== 'info').length, 0);
  const windows = dashboard.currentAccountLimits()[0].windows;
  assert.ok(windows.every((window) => window.remaining === null && window.displayRemaining === null));
  dashboard.reportTrayStatus();
  assert.equal(dashboard.payloads[0].lowestRemaining, null);
  dashboard.renderCompactView();
  const compact = dashboard.nodes.get('#compact-headroom').innerHTML;
  assert.doesNotMatch(compact, /null%|undefined%|class="is-low"/);
});

test('unknown windows do not replace a known tray minimum', () => {
  const dashboard = loadDashboard([accountFixture('mixed', [
    { tag: '5H', remainingPercent: 45, resetsAt: futureReset() },
    { tag: '7D', remainingPercent: null, resetsAt: futureReset() },
    { tag: '30D', remainingPercent: 70, resetsAt: futureReset() }
  ])], { tray: true });
  dashboard.reportTrayStatus();
  assert.equal(dashboard.payloads[0].lowestRemaining, 45);
});

test('positive fractions stay visible and exact zero stays exhausted', () => {
  const dashboard = loadDashboard([accountFixture('known', [
    { tag: '5H', label: '5 hour window', remainingPercent: 0.2, resetsAt: futureReset() },
    { tag: '7D', label: 'Weekly window', remainingPercent: 0, resetsAt: futureReset() }
  ])]);
  assert.equal(dashboard.displayPercent(0.2), 1);
  assert.equal(dashboard.displayPercent(0), 0);
  assert.equal(dashboard.displayPercent(null), '—');
  assert.equal(dashboard.currentHeadroom()[0].remaining, 0);
  assert.equal(dashboard.accountAvailability(dashboard.state.snapshot.codexAccounts[0]).tone, 'depleted');
  dashboard.renderCodexAccounts();
  const html = dashboard.nodes.get('#codex-accounts-grid').innerHTML;
  assert.match(html, /1% left/);
  assert.match(html, /0% left/);
  assert.match(html, /aria-valuenow="0\.2"/);
});

test('unreported card data cannot imply a full quota or an available account', () => {
  const dashboard = loadDashboard([accountFixture('unreported', [{ tag: '5H', label: '5 hour window', remainingPercent: null }])]);
  assert.equal(dashboard.accountAvailability(dashboard.state.snapshot.codexAccounts[0]).tone, 'unknown');
  dashboard.renderCodexAccounts();
  const html = dashboard.nodes.get('#codex-accounts-grid').innerHTML;
  assert.match(html, /Not reported/);
  assert.doesNotMatch(html, /(?:100|0)% left/);
  assert.doesNotMatch(html, /aria-valuenow="(?:100|0)"/);
  assert.equal(dashboard.providerLimits('claude').plan, 'Not reported');
  assert.equal(dashboard.currentDaily().length, 0, 'empty real history does not become demo history');
});

test('cached allowance is distinguished from current availability', () => {
  const account = { ...accountFixture('cached', [{ tag: '5H', remainingPercent: 65, resetsAt: futureReset() }]), rateStale: true };
  const dashboard = loadDashboard([account]);
  assert.equal(dashboard.accountAvailability(account).tone, 'unknown');
  dashboard.renderCodexAccounts();
  assert.match(dashboard.nodes.get('#codex-accounts-grid').innerHTML, /Cached limits/);
});

test('zero daily tokens stay zero even when an old cost field is populated', () => {
  const dashboard = loadDashboard();
  dashboard.state.metric = 'tokens';
  assert.equal(dashboard.chartValue({ codex: 10, codexTokens: 0 }, 'codex'), 0);
  assert.equal(dashboard.chartValue({ codex: 10 }, 'codex'), 10_000_000);
});

test('reset labels use the local calendar and display an explicit time zone', () => {
  const dashboard = loadDashboard();
  const timestamp = Math.floor(new Date('2026-09-25T23:30:00Z').getTime() / 1000);
  const expected = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(timestamp * 1000));
  assert.equal(dashboard.formatResetDate(timestamp), expected);
  assert.equal(dashboard.resetLabel(null), 'reset time unavailable');
});

test('account and provider text is escaped before card insertion', () => {
  const dashboard = loadDashboard([accountFixture('<img src=x onerror=alert(1)>', [])]);
  dashboard.renderCodexAccounts();
  const html = dashboard.nodes.get('#codex-accounts-grid').innerHTML;
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('desktop IPC preserves unknown, exhausted and fractional windows distinctly', () => {
  const { context, handlers, presentation } = loadDesktop();
  handlers.get('pulse:tray-status')({ senderFrame: { url: 'http://127.0.0.1:5188/?surface=tray' } }, {
    lowestRemaining: null,
    accounts: [{ id: 'test', profile: '.test', windows: [
      { tag: '5H', remaining: null, displayRemaining: null },
      { tag: '7D', remaining: 0, displayRemaining: 0 },
      { tag: '30D', remaining: 0.2 }
    ] }]
  });
  const status = vm.runInContext('trayStatus', context);
  assert.equal(status.lowestRemaining, null);
  assert.equal(status.accounts[0].windows[0].remaining, null);
  assert.equal(status.accounts[0].windows[0].displayRemaining, null);
  assert.equal(status.accounts[0].windows[1].remaining, 0);
  assert.equal(status.accounts[0].windows[2].displayRemaining, 1);
  assert.equal(presentation.title, 'C1 —/0%/1%');
  assert.match(presentation.tooltip, /5H —, 7D 0%, 30D 1%/);
});

test('rapid date-range changes discard a superseded response and load the latest selection', async () => {
  const dashboard = loadSyncDashboard();
  const previous = dashboard.state.snapshot;
  const firstSync = dashboard.syncUsage({ quiet: true });
  assert.equal(dashboard.requests[0].url, '/api/usage?days=30');
  dashboard.state.range = 7;
  await dashboard.syncUsage({ quiet: true });
  dashboard.state.range = 90;
  await dashboard.syncUsage({ quiet: true });
  assert.equal(dashboard.requests.length, 1, 'in-flight requests are not duplicated');

  dashboard.requests[0].resolve({ ok: true, json: async () => ({ ...previous, rangeDays: 30, summary: { totalTokens: 30 } }) });
  await firstSync;
  assert.equal(dashboard.state.snapshot, previous, 'a stale response does not replace the visible snapshot');
  assert.equal(dashboard.rendered.length, 0);
  assert.equal(dashboard.requests.length, 2);
  assert.equal(dashboard.requests[1].url, '/api/usage?days=90');

  dashboard.requests[1].resolve({ ok: true, json: async () => ({ ...previous, rangeDays: 90, rangeKey: 90, summary: { totalTokens: 90 } }) });
  await flushAsyncWork();
  assert.equal(dashboard.state.snapshot.rangeDays, 90);
  assert.equal(dashboard.state.snapshot.summary.totalTokens, 90);
  assert.equal(dashboard.state.range, 90);
  assert.equal(dashboard.state.syncing, false);
  assert.equal(dashboard.rendered.length, 1);
  assert.equal(dashboard.rendered[0].range, 90);
});

test('an offline range change retains the last real snapshot and restores its date range', async () => {
  const dashboard = loadSyncDashboard();
  const previous = dashboard.state.snapshot;
  previous.summary.totalTokens = 12345;
  dashboard.state.range = 7;
  const sync = dashboard.syncUsage({ quiet: true });
  dashboard.requests[0].reject(new Error('offline'));
  await sync;
  // Restoring the prior range may schedule a refresh for that range. Settle it
  // with the same network failure so this test cannot leave work in flight.
  for (const request of dashboard.requests.slice(1)) request.reject(new Error('offline'));
  await flushAsyncWork();
  assert.equal(dashboard.state.snapshot, previous);
  assert.equal(dashboard.state.snapshot.summary.totalTokens, 12345);
  assert.equal(dashboard.state.range, 30);
  assert.equal(dashboard.state.syncError, true);
  assert.equal(dashboard.state.syncing, false);
  assert.ok(dashboard.rendered.every((render) => render.snapshot === previous && render.range === 30));
});

test('an offline first load keeps actual empty startup data without demo accounts or usage', async () => {
  const dashboard = loadSyncDashboard();
  dashboard.state.snapshot = dashboard.initialSnapshot;
  const sync = dashboard.syncUsage({ quiet: true });
  dashboard.requests[0].reject(new Error('offline'));
  await sync;
  assert.equal(dashboard.state.snapshot, dashboard.initialSnapshot);
  assert.equal(dashboard.state.snapshot.fetchedAt, null);
  assert.equal(dashboard.state.snapshot.providers.length, 0);
  assert.equal(dashboard.state.snapshot.codexAccounts.length, 0);
  assert.equal(dashboard.currentDaily().length, 0);
  assert.equal(dashboard.state.syncError, true);
  assert.equal(dashboard.state.syncing, false);
  assert.equal(dashboard.requests.length, 1);
});
