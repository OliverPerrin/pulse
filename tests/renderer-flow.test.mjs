import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const insightsSource = await readFile(new URL('../dashboard-insights.js', import.meta.url), 'utf8');

function renderer({ tray = false } = {}) {
  const nodes = new Map();
  const document = { hidden: false, activeElement: null, listeners: {}, querySelectorAll: () => [], addEventListener(name, handler) { this.listeners[name] = handler; } };
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, isConnected: true, innerHTML: '', textContent: '', children: [], listeners: {}, attributes: {}, dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelectorAll() { return this.children; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 760 }),
      focus() { document.activeElement = this; }
    });
    return nodes.get(selector);
  };
  document.body = node('body');
  document.querySelector = node;
  const reported = [];
  const frames = new Map();
  const context = vm.createContext({
    window: { location: { search: tray ? '?surface=tray' : '' }, pulseDesktop: { reportTrayStatus: (payload) => reported.push(payload) } },
    document, URLSearchParams, Intl, Date, console,
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (callback) => { const id = frames.size + 1; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id)
  });
  vm.runInContext(source.slice(0, source.lastIndexOf('\nhydrateIcons();')), context);
  const api = vm.runInContext('({ state, renderAll, flushDeferredRender, setCompactMode, setPanel, setupInteractions, setupChartTooltip })', context);
  return { ...api, context, nodes, node, document, reported, frames };
}

test('tray renders compact content only and keeps reporting status while hidden', () => {
  const ui = renderer({ tray: true });
  const calls = [];
  ui.context.capture = (name) => calls.push(name);
  vm.runInContext(`
    renderSummary = () => capture('full');
    renderCompactView = () => { capture('compact'); reportTrayStatus(); };
  `, ui.context);
  ui.renderAll();
  assert.deepEqual(calls, ['compact']);
  ui.document.hidden = true;
  ui.renderAll();
  assert.deepEqual(calls, ['compact']);
  assert.equal(ui.reported.length, 2);
  ui.document.hidden = false;
  ui.flushDeferredRender();
  assert.deepEqual(calls, ['compact', 'compact']);
});

test('leaving compact view renders the newest dashboard snapshot', () => {
  const ui = renderer();
  const calls = [];
  ui.context.capture = (name) => calls.push(name);
  vm.runInContext(`
    renderSummary = () => capture(state.snapshot.fetchedAt);
    renderCompactView = () => {};
  `, ui.context);
  ui.state.compactMode = true;
  ui.renderAll();
  ui.state.snapshot.fetchedAt = 123;
  ui.renderAll();
  assert.deepEqual(calls, []);
  ui.setCompactMode(false);
  assert.deepEqual(calls, [123]);
  assert.equal(ui.document.activeElement, ui.node('#compact-view-button'));
});

test('panels move focus, keep background inert, and return focus to the original control', () => {
  const ui = renderer();
  const opener = ui.node('#open-alerts');
  const notificationsClose = ui.node('notification-close');
  const settingsClose = ui.node('settings-close');
  ui.node('#notifications-panel').children.push(notificationsClose);
  ui.node('#settings-panel').children.push(settingsClose);
  opener.focus();
  ui.setPanel('notifications-panel');
  assert.equal(ui.document.activeElement, notificationsClose);
  assert.equal(ui.node('.app-shell').inert, true);
  assert.equal(ui.node('#notifications-panel').attributes['aria-modal'], 'true');
  ui.setPanel('settings-panel');
  assert.equal(ui.document.activeElement, settingsClose);
  ui.setPanel(null);
  assert.equal(ui.document.activeElement, opener);
  assert.equal(ui.node('.app-shell').inert, false);
});

test('panel keyboard navigation wraps and Escape returns to the opener', () => {
  const ui = renderer();
  const opener = ui.node('#settings-button');
  const first = ui.node('first-setting');
  const last = ui.node('last-setting');
  ui.node('#settings-panel').children.push(first, last);
  ui.setupInteractions();
  opener.focus();
  ui.setPanel('settings-panel');
  let prevented = false;
  last.focus();
  ui.document.listeners.keydown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.document.activeElement, first);
  ui.document.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(ui.document.activeElement, last);
  ui.document.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(ui.document.activeElement, opener);
  assert.equal(ui.node('#settings-panel').hidden, true);
});

test('chart pointer work is collapsed to one animation frame and canceled on leave', () => {
  const ui = renderer();
  ui.state.snapshot.daily = [{ date: '2026-10-01', codex: 1 }];
  ui.state.snapshot.providers = [{ id: 'codex', shortName: 'Codex', color: '#ffffff' }];
  ui.setupChartTooltip();
  const area = ui.node('#chart-area');
  area.listeners.mousemove({ clientX: 20, clientY: 20 });
  area.listeners.mousemove({ clientX: 40, clientY: 30 });
  assert.equal(ui.frames.size, 1);
  ui.frames.values().next().value();
  assert.equal(ui.node('#chart-hover-line').attributes.x1, 40);
  area.listeners.mousemove({ clientX: 60, clientY: 30 });
  area.listeners.mouseleave();
  assert.equal(ui.node('#chart-tooltip').hidden, true);
  assert.equal(ui.node('#chart-hover-line').attributes.opacity, '0');
});

test('unchanged insights preserve their DOM and keyboard focus across polling', () => {
  let writes = 0;
  const target = { set innerHTML(value) { this.markup = value; writes += 1; } };
  const context = vm.createContext({ window: {}, document: { querySelector: () => target }, Intl, Date });
  vm.runInContext(insightsSource, context);
  const options = { daily: [{ date: '2026-10-01', codex: 1 }], providers: [{ id: 'codex', name: 'Codex', cost: 1 }] };
  context.window.renderUsageInsights(options);
  context.window.renderUsageInsights(options);
  assert.equal(writes, 1);
  context.window.renderUsageInsights({ ...options, metric: 'tokens' });
  assert.equal(writes, 2);
});
