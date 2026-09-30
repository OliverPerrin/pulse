import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const desktopSource = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const futureReset = () => Math.floor(Date.now() / 1000) + 3600;

function dashboard(claude) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelectorAll: () => [] });
    return nodes.get(selector);
  };
  const payloads = [];
  const context = vm.createContext({
    window: { location: { search: '?surface=tray' }, pulseDesktop: { reportTrayStatus: (payload) => payloads.push(payload) } },
    document: { body: node('body'), querySelector: node, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, URLSearchParams, Intl, Date, console
  });
  vm.runInContext(appSource.slice(0, appSource.lastIndexOf('\nhydrateIcons();')), context);
  const api = vm.runInContext('({ state, currentHeadroom, currentAccountLimits, renderLimits, renderCompactView, reportTrayStatus })', context);
  api.state.snapshot = { fetchedAt: Date.now(), providers: [], codexAccounts: [
    { id: 'codex-1', profile: 'Codex personal', plan: 'plus', windows: [{ tag: '5H', remainingPercent: 80, resetsAt: futureReset() }] },
    { id: 'codex-2', profile: 'Codex work', plan: 'plus', windows: [{ tag: '7D', remainingPercent: 70, resetsAt: futureReset() }] }
  ], limits: { claude }, daily: [], summary: {} };
  return { ...api, nodes, payloads };
}

test('Claude limits render without Claude sessions and appear in compact view and tray', () => {
  const ui = dashboard({ connected: true, plan: 'Pro', planSource: 'providerReported', limits: [
    { tag: '5H', label: '5 hour window', remaining: 35, resetsAt: futureReset() },
    { tag: '7D', label: 'Weekly window', remaining: 62, resetsAt: futureReset() }
  ] });
  ui.renderLimits();
  const main = ui.nodes.get('#codex-accounts-grid').innerHTML;
  assert.match(main, /Claude Code/);
  assert.match(main, /35% left/);
  assert.match(main, /62% left/);
  assert.match(main, /Weekly window/);
  assert.equal(ui.currentHeadroom()[0].remaining, 35);
  const accounts = ui.currentAccountLimits();
  assert.deepEqual(Array.from(accounts, (account) => account.identityTag), ['C1', 'C2', 'Claude']);
  assert.equal(accounts[2].providerId, 'claude');
  ui.renderCompactView();
  const compact = ui.nodes.get('#compact-headroom').innerHTML;
  assert.match(compact, /<strong>Claude<\/strong>/);
  assert.match(compact, /35%/);
  assert.match(compact, /62%/);
  assert.doesNotMatch(compact, /<span>C3<\/span>/);
  assert.equal(ui.payloads.at(-1).lowestRemaining, 35);
  assert.equal(ui.payloads.at(-1).accounts[2].identityTag, 'Claude');
});

test('Claude unknown and elapsed windows retain unknown percentages across surfaces', () => {
  const ui = dashboard({ connected: true, plan: 'Pro', limits: [
    { tag: '5H', label: '5 hour window', remaining: null, resetsAt: futureReset() },
    { tag: '7D', label: 'Weekly window', remaining: 0, resetsAt: 1 }
  ] });
  assert.ok(ui.currentAccountLimits()[2].windows.every((window) => window.remaining === null));
  assert.equal(ui.currentHeadroom().length, 2, 'only the known Codex windows participate in minima');
  ui.renderLimits();
  const claudeMain = ui.nodes.get('#codex-accounts-grid').innerHTML.match(/<article[^>]+data-subscription-provider="claude"[\s\S]*?<\/article>/)?.[0];
  assert.ok(claudeMain);
  assert.doesNotMatch(claudeMain, /(?:^|\D)(?:0|100)% left/);
  ui.renderCompactView();
  const claudeCard = ui.nodes.get('#compact-headroom').innerHTML.split('data-provider-id="claude"')[1];
  assert.doesNotMatch(claudeCard, /class="is-low"|null%|undefined%/);
  assert.equal(ui.payloads.at(-1).lowestRemaining, 70);
});

test('Claude cached windows are labeled and authenticated subscriptions remain visible without quota', () => {
  const cached = dashboard({ connected: true, plan: 'Pro', stale: true, limits: [
    { tag: '5H', label: '5 hour window', remaining: 20, resetsAt: futureReset() }
  ] });
  cached.renderCompactView();
  assert.match(cached.nodes.get('#compact-headroom').innerHTML, /Cached ·/);
  const unreported = dashboard({ connected: true, plan: 'Pro', unreported: true });
  unreported.renderCompactView();
  assert.match(unreported.nodes.get('#compact-headroom').innerHTML, /Claude/);
  assert.match(unreported.nodes.get('#compact-headroom').innerHTML, /No current limit reported/);
});

test('main Claude card keeps cached percentages, source age and retry context visible', () => {
  const ui = dashboard({ connected: true, plan: 'Pro', stale: true, fetchedAt: Date.now() - 120_000,
    message: 'Claude is rate limiting refreshes. Retrying in 20 minutes. <private>',
    limits: [
      { tag: '5H', label: '5 hour window', remaining: 53, resetsAt: futureReset() },
      { tag: '7D', label: 'Weekly window', remaining: 96, resetsAt: futureReset() }
    ]
  });
  ui.renderLimits();
  const main = ui.nodes.get('#codex-accounts-grid').innerHTML;
  assert.match(main, /53% left/);
  assert.match(main, /96% left/);
  assert.match(main, /Cached limits · Last checked 2m ago/);
  assert.match(main, /Retrying in 20 minutes/);
  assert.match(main, /&lt;private&gt;/);
  assert.doesNotMatch(main, /<private>/);
});

test('desktop IPC retains Claude identity and percentages in menu-bar presentation', () => {
  const handlers = new Map();
  const presentation = {};
  const context = vm.createContext({
    baseUrl: 'http://127.0.0.1:5188', isMac: true,
    trayStatus: { lowestRemaining: null, accounts: [], warningCount: 0, paused: false },
    tray: { setTitle: (value) => { presentation.title = value; }, setToolTip: (value) => { presentation.tooltip = value; } },
    ipcMain: { on: (event, handler) => handlers.set(event, handler) },
    Menu: { buildFromTemplate: (items) => items }, app: { getLoginItemSettings: () => ({ openAtLogin: false }) }
  });
  vm.runInContext(desktopSource.slice(desktopSource.indexOf('function safePercent('), desktopSource.indexOf('function createTray(')), context);
  vm.runInContext(desktopSource.slice(desktopSource.indexOf('function registerIpc('), desktopSource.indexOf('function createApplicationMenu(')), context);
  vm.runInContext('registerIpc()', context);
  handlers.get('pulse:tray-status')({ senderFrame: { url: 'http://127.0.0.1:5188/?surface=tray' } }, {
    lowestRemaining: 0.2, accounts: [{ id: 'claude-subscription', providerId: 'claude', identityTag: 'Claude', profile: 'Claude', windows: [
      { tag: '5H', remaining: 0.2 }, { tag: '7D', remaining: 0 }
    ] }]
  });
  assert.equal(presentation.title, 'Claude 1%/0%');
  assert.match(presentation.tooltip, /5H 1%, 7D 0%/);
  assert.equal(vm.runInContext('trayStatus.accounts[0].providerId', context), 'claude');
});
