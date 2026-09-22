const desktopSurface = new URLSearchParams(window.location.search).get('surface');
const isDesktopTraySurface = desktopSurface === 'tray';
const isDesktopAppSurface = desktopSurface === 'desktop';
if (isDesktopTraySurface) document.body.classList.add('desktop-tray-surface');
if (isDesktopAppSurface) document.body.classList.add('desktop-app-surface');

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  layers: '<path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  'bar-chart': '<path d="M4 19V9M10 19V4M16 19v-7M22 19H2"/>',
  activity: '<path d="M3 12h3l2.2-6 4.3 12 2.4-6H21"/>',
  settings: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1A1.8 1.8 0 0 0 3.3 12a1.8 1.8 0 0 0-1.3-3.1h-.2a1.8 1.8 0 0 1 0-3.6H2A1.8 1.8 0 0 0 3.3 2.2l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1A1.8 1.8 0 0 0 8.9-1.6v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1A1.8 1.8 0 0 0 19.4 5a1.8 1.8 0 0 0 1.3 3.1h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-1.3 3.3Z"/>',
  shield: '<path d="M12 3 20 6v5c0 5.1-3.4 8.8-8 10-4.6-1.2-8-4.9-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
  chevrons: '<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-3.9L3 10"/><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 3.9L21 14"/><path d="M21 19v-5h-5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  'trend-up': '<path d="M3 17 9 11l4 4 8-9"/><path d="M15 6h6v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  'arrow-right': '<path d="M4 12h16M14 6l6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  alert: '<path d="M10.3 4.2 2.7 17.5A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.5L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 9h5M12 13h5"/>'
};

const providerMeta = {
  codex: { name: 'Codex', short: 'CX', color: '#e5e7eb', glyph: '◎' },
  claude: { name: 'Claude Code', short: '✳', color: '#ff825f', glyph: '✳' },
  commandcode: { name: 'Command Code', short: '⌘', color: '#b99cff', glyph: '⌘' },
  cursor: { name: 'Cursor', short: '◒', color: '#79a7ff', glyph: '◒' },
  opencode: { name: 'OpenCode', short: 'OC', color: '#64dcc4', glyph: '↗' }
};

const defaultSettings = { pollSeconds: 15, notifyCritical: true, notifySync: true, compactDefault: false };
const defaultWorkspaces = [{ id: 'oliver-local', name: "Oliver's local", type: 'Personal workspace', initials: 'OP' }];

function readStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be unavailable in private contexts. */ }
}

const storedSettings = { ...defaultSettings, ...readStored('usage-pulse-settings', {}) };
const storedWorkspaces = readStored('usage-pulse-workspaces', defaultWorkspaces);

const state = {
  snapshot: { fetchedAt: null, mode: 'loading', rangeDays: 30, providers: [], models: [], daily: [], codexAccounts: [], limits: {}, summary: {} },
  range: 30,
  metric: 'cost',
  filter: 'all',
  query: '',
  tableMode: 'model',
  syncing: false,
  paused: false,
  secondsToPoll: storedSettings.pollSeconds,
  toastTimer: null,
  expandedModels: false,
  settings: storedSettings,
  workspaces: Array.isArray(storedWorkspaces) && storedWorkspaces.length ? storedWorkspaces : defaultWorkspaces,
  activeWorkspaceId: readStored('usage-pulse-active-workspace', 'oliver-local'),
  readNotifications: new Set(readStored('usage-pulse-read-notifications', [])),
  compactMode: isDesktopTraySurface ? true : isDesktopAppSurface ? false : storedSettings.compactDefault
};

function icon(name) {
  const path = icons[name] || icons.activity;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}

// Building an Intl formatter costs roughly 60x what reusing one does, and a
// full render formats hundreds of values, so every formatter is built once.
const intlCache = new Map();

function numberFormat(options) {
  const key = `n:${JSON.stringify(options)}`;
  let formatter = intlCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', options);
    intlCache.set(key, formatter);
  }
  return formatter;
}

function dateTimeFormat(options) {
  const key = `d:${JSON.stringify(options)}`;
  let formatter = intlCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', options);
    intlCache.set(key, formatter);
  }
  return formatter;
}

const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Model names, account profiles and workspace titles all reach the DOM through
// template strings, and workspace titles are user supplied.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function formatCurrency(value, digits = 2) {
  return numberFormat({ style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
}

function formatCompact(value, digits = 2) {
  const number = Number(value) || 0;
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const match = units.find(([threshold]) => Math.abs(number) >= threshold);
  if (!match) return numberFormat({ maximumFractionDigits: digits }).format(number);
  const rounded = (number / match[0]).toFixed(number / match[0] >= 100 ? 0 : digits).replace(/\.0+$|(?<=\.\d)0+$/, '');
  return `${rounded}${match[1]}`;
}

function formatTokens(value) {
  return formatCompact(value, 2);
}

function safePercent(value, fallback = 0) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function displayPercent(value) {
  const percent = safePercent(value, null);
  if (percent === null) return '—';
  if (percent <= 0) return 0;
  // Never hide a positive remainder because of integer rounding. This is the
  // single display rule used by the full dashboard, compact view, and tray.
  return Math.max(1, Math.round(percent));
}

function displayUsedPercent(window) {
  if (safePercent(window?.remainingPercent, null) === null) return '—';
  return 100 - displayPercent(window?.remainingPercent);
}

function windowRemaining(window, key = 'remainingPercent') {
  if (window.status === 'reset_pending' || (window.resetsAt && Number(window.resetsAt) * 1000 <= Date.now())) return null;
  return safePercent(window[key], null);
}

function providerLimits(providerId) {
  return state.snapshot.limits?.[providerId] || {
    plan: providerId === 'opencode' ? 'BYOK' : 'Not reported',
    unreported: true,
    note: providerId === 'opencode' ? 'Connected API providers set the limits' : 'Local adapter',
    message: providerId === 'opencode' ? 'Check the allowance of the API provider connected to OpenCode.' : 'This adapter has not reported a current subscription or allowance. Check the provider’s account page for details.'
  };
}

function formatDate(date, options = { month: 'short', day: 'numeric' }) {
  return dateTimeFormat(options).format(new Date(`${date}T12:00:00`));
}

function formatResetDate(timestamp) {
  return dateTimeFormat({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(Number(timestamp) * 1000));
}

function formatCountdown(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function currentProviders() {
  return state.snapshot.providers || [];
}

function currentModels() {
  return state.snapshot.models || [];
}

function currentCodexAccounts() {
  return state.snapshot.codexAccounts || [];
}

function liveSummary() {
  const source = state.snapshot.summary || {};
  const providers = currentProviders();
  const totalCost = providers.reduce((sum, provider) => sum + (Number(provider.cost) || 0), 0);
  const totalTokens = providers.reduce((sum, provider) => sum + (Number(provider.tokens) || 0), 0);
  return {
    ...source,
    totalCost,
    totalTokens,
    processedTokens: Number(source.processedTokens) || 0,
    cachedInput: Number(source.cachedInput) || 0,
    uncachedInput: Number(source.uncachedInput) || 0,
    output: Number(source.output) || 0,
    cacheSavings: Number(source.cacheSavings) || 0,
    activeSessions: providers.reduce((sum, provider) => sum + (Number(provider.sessions) || 0), 0)
  };
}

function currentDaily() {
  const daily = state.snapshot.daily || [];
  return state.range === 'lifetime' ? daily : daily.slice(-state.range);
}

function dailyTokenValue(point, providerId) {
  const tokenKey = `${providerId}Tokens`;
  // Zero is a valid daily total. Only use the legacy cost-derived fallback
  // when the token field is genuinely absent from an older snapshot.
  if (Object.prototype.hasOwnProperty.call(point, tokenKey)) return Number(point[tokenKey]) || 0;
  return Number(point[providerId]) * 1_000_000 || 0;
}

function chartValue(point, providerId) {
  return state.metric === 'cost' ? Number(point[providerId]) || 0 : dailyTokenValue(point, providerId);
}

function selectedPeriodDays() {
  return Math.max(currentDaily().length, 1);
}

function selectedPeriodLabel() {
  return state.range === 'lifetime' ? 'Lifetime' : `Last ${state.range} days`;
}

function activeWorkspace() {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) || state.workspaces[0];
}

function workspaceInitials(name) {
  return String(name || 'Workspace').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function currentHeadroom() {
  const accountWindows = currentCodexAccounts().flatMap((account) => (account.windows || []).map((window) => ({
    id: `${account.id}-${window.tag}`,
    provider: account.profile,
    label: window.label,
    remaining: windowRemaining(window),
    reset: resetLabel(window.resetsAt),
    target: '#limits'
  })));
  const otherWindows = currentProviders().filter((provider) => provider.id !== 'codex').flatMap((provider) => {
    const meta = providerLimits(provider.id);
    return (meta?.limits || []).map((window) => ({
      id: `${provider.id}-${window.tag}`,
      provider: provider.shortName,
      label: window.label,
      remaining: windowRemaining(window, 'remaining'),
      reset: window.resetsAt ? resetLabel(window.resetsAt) : window.reset,
      target: '#limits'
    }));
  });
  return [...accountWindows, ...otherWindows].filter((window) => window.remaining !== null).sort((a, b) => a.remaining - b.remaining);
}

function currentAccountLimits() {
  return currentCodexAccounts().map((account, index) => ({
    id: account.id || `codex-account-${index + 1}`,
    profile: account.profile || `Codex ${index + 1}`,
    plan: planLabel(account.plan),
    windows: (account.windows || []).map((window) => {
      const remaining = windowRemaining(window);
      return {
        tag: window.tag || 'LIVE',
        label: window.label || 'Current window',
        remaining,
        displayRemaining: remaining === null ? null : displayPercent(remaining),
        reset: resetLabel(window.resetsAt)
      };
    })
  }));
}

function creditSummary() {
  const accounts = currentCodexAccounts();
  const usageCredits = accounts.reduce((sum, account) => sum + (account.credits?.hasCredits ? Math.max(0, Number(account.credits.balance) || 0) : 0), 0);
  const reportedBankedResets = accounts.map((account) => account.bankedResets).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return {
    usageCredits,
    bankedResets: reportedBankedResets.length ? reportedBankedResets.reduce((sum, value) => sum + Number(value), 0) : null
  };
}

function notificationItems() {
  const headroom = currentHeadroom();
  const items = (state.settings.notifyCritical ? headroom.filter((window) => window.remaining < 20) : []).map((window) => ({
    id: `headroom-${window.id}-${window.remaining}`,
    level: window.remaining <= 0 ? 'critical' : window.remaining < 20 ? 'warning' : 'notice',
    icon: window.remaining <= 0 ? 'alert' : 'shield',
    title: window.remaining <= 0 ? `${window.provider} window depleted` : `${window.provider} headroom is ${displayPercent(window.remaining)}%`,
    detail: `${window.label} · ${window.reset}`,
    target: window.target
  }));
  const credits = creditSummary();
  if (credits.usageCredits > 0) items.push({ id: `credits-${credits.usageCredits.toFixed(2)}`, level: 'info', icon: 'layers', title: `${formatCompact(credits.usageCredits)} usage credits available`, detail: 'Provider-reported Codex balance', target: '#limits' });
  if (state.settings.notifySync) items.push({ id: `sync-${new Date(state.snapshot.fetchedAt || Date.now()).toISOString().slice(0, 16)}`, level: 'info', icon: 'check', title: 'Local adapters synced', detail: `${currentProviders().length} providers · ${currentProviders().reduce((sum, provider) => sum + (Number(provider.sessions) || 0), 0)} sessions observed`, target: '#activity-log' });
  return items;
}

function unreadNotifications() {
  return notificationItems().filter((item) => !state.readNotifications.has(item.id));
}

function renderProviderGlyph(providerId) {
  const meta = providerMeta[providerId] || providerMeta.codex;
  return `<span class="provider-glyph ${providerId}" style="--provider-color:${meta.color}">${meta.glyph}</span>`;
}

function renderChartLegend() {
  const visible = currentProviders();
  document.querySelector('#chart-legend').innerHTML = visible.map((provider) => `<span class="legend-item"><i class="legend-dot" style="background:${provider.color}"></i>${provider.shortName}</span>`).join('');
}

function renderProviderBreakdown() {
  const providers = currentProviders();
  const tokensMetric = state.metric === 'tokens';
  document.querySelector('.chart-card h2').textContent = tokensMetric ? 'Daily tokens' : 'Daily cost';
  const total = providers.reduce((sum, provider) => sum + (tokensMetric ? (Number(provider.tokens) || 0) : (Number(provider.cost) || 0)), 0) || 1;
  const html = providers.map((provider, index) => {
    const share = tokensMetric ? ((Number(provider.tokens) || 0) / total) * 100 : ((Number(provider.cost) || 0) / total) * 100;
    const headline = tokensMetric ? formatTokens(provider.tokens) : formatCurrency(provider.cost);
    const metadata = tokensMetric ? `${share.toFixed(1)}% of tokens · ${formatCurrency(provider.cost)} API estimate` : `${share.toFixed(1)}% of cost · ${formatTokens(provider.tokens)} tokens`;
    return `<div class="provider-row" style="--provider-color:${provider.color};--delay:${index * 80}ms"><div class="provider-row-top"><div class="provider-label">${renderProviderGlyph(provider.id)}<strong>${escapeHtml(provider.name)}</strong></div><strong>${headline}</strong></div><div class="provider-bar"><span style="width:${Math.max(share, 1.5)}%"></span></div><div class="provider-meta">${metadata}</div></div>`;
  }).join('');
  document.querySelector('#provider-breakdown').innerHTML = html;
}

function renderChart() {
  const chart = document.querySelector('#usage-chart');
  const seriesGroup = document.querySelector('#chart-series');
  const dotGroup = document.querySelector('#chart-dots');
  const points = currentDaily();
  const providers = currentProviders();
  const keys = providers.map((provider) => provider.id);
  // A lifetime range can hold thousands of samples per series, which is more
  // than Math.max(...values) can safely spread onto the call stack.
  let peak = 1;
  for (const point of points) {
    for (const key of keys) {
      const value = chartValue(point, key);
      if (value > peak) peak = value;
    }
  }
  const max = peak * 1.16;
  const width = 760;
  const top = 24;
  const bottom = 240;
  const height = bottom - top;
  const x = (index) => points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
  const y = (value) => bottom - (value / max) * height;
  const makePath = (key) => {
    const coordinates = points.map((point, index) => ({
      x: x(index),
      y: y(chartValue(point, key))
    }));
    if (coordinates.length < 2) return coordinates.length ? `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}` : '';

    // Shape-preserving cubic interpolation rounds extrema without overshooting
    // the measured values between adjacent daily samples.
    const slopes = coordinates.slice(0, -1).map((point, index) => {
      const next = coordinates[index + 1];
      return (next.y - point.y) / Math.max(next.x - point.x, Number.EPSILON);
    });
    const tangents = coordinates.map((_, index) => {
      if (index === 0) return slopes[0];
      if (index === coordinates.length - 1) return slopes[slopes.length - 1];
      const before = slopes[index - 1];
      const after = slopes[index];
      return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
    });

    return coordinates.slice(0, -1).reduce((path, point, index) => {
      const next = coordinates[index + 1];
      const segmentWidth = next.x - point.x;
      const firstControl = { x: point.x + segmentWidth / 3, y: point.y + tangents[index] * segmentWidth / 3 };
      const secondControl = { x: next.x - segmentWidth / 3, y: next.y - tangents[index + 1] * segmentWidth / 3 };
      return `${path} C ${firstControl.x.toFixed(2)} ${firstControl.y.toFixed(2)}, ${secondControl.x.toFixed(2)} ${secondControl.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
    }, `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}`);
  };
  const makeArea = (key) => `${makePath(key)} L ${width} ${bottom} L 0 ${bottom} Z`;
  seriesGroup.innerHTML = providers.map((provider, index) => `<path class="chart-series-area" d="${makeArea(provider.id)}" fill="url(#area-${provider.id})"></path><path class="chart-series-line ${index > 1 ? 'secondary' : ''}" style="--series-color:${provider.color}" d="${makePath(provider.id)}"></path>`).join('');
  const lastPoint = points[points.length - 1] || {};
  dotGroup.innerHTML = providers.map((provider) => {
    const value = chartValue(lastPoint, provider.id);
    return `<circle class="chart-dot" style="--series-color:${provider.color}" cx="${x(points.length - 1)}" cy="${y(value)}" r="3"></circle>`;
  }).join('');
  document.querySelector('.chart-y-labels').innerHTML = [1, .66, .33, 0].map((ratio) => `<span>${state.metric === 'cost' ? formatCurrency(max * ratio, 0) : formatTokens(max * ratio)}</span>`).join('');
  const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].filter(Boolean);
  document.querySelector('#chart-x-labels').innerHTML = labels.map((point) => `<span>${formatDate(point.date, { month: 'short', day: 'numeric' }).toUpperCase()}</span>`).join('');
  chart.dataset.max = String(max);
}

function renderSummary() {
  const summary = liveSummary();
  const providers = currentProviders();
  const totalCost = providers.reduce((sum, provider) => sum + (Number(provider.cost) || 0), 0) || 1;
  const totalTokens = providers.reduce((sum, provider) => sum + (Number(provider.tokens) || 0), 0) || 1;
  providers.forEach((provider) => {
    provider.share = provider.cost / totalCost * 100;
    provider.tokenShare = provider.tokens / totalTokens * 100;
  });
  const tokensMetric = state.metric === 'tokens';
  document.querySelector('#total-cost').textContent = tokensMetric ? formatTokens(summary.totalTokens) : formatCurrency(summary.totalCost);
  document.querySelector('#total-metric-label').textContent = tokensMetric ? 'observed tokens' : 'API estimate';
  document.querySelector('#cost-delta').textContent = tokensMetric ? 'Observed' : 'API estimate';
  document.querySelector('#metric-delta-label').textContent = tokensMetric ? 'in the selected period' : 'from observed tokens';
  const dates = currentDaily();
  if (dates.length) document.querySelector('#date-range').textContent = `${formatDate(dates[0].date)} — ${formatDate(dates[dates.length - 1].date)}`;
  renderProviderBreakdown();
  renderChartLegend();
}

function renderStats() {
  const summary = liveSummary();
  const cells = [
    ['Processed tokens', formatTokens(summary.processedTokens), `${formatTokens(summary.processedTokens / selectedPeriodDays())} per calendar day`],
    ['Cached input', formatTokens(summary.cachedInput), 'Input tokens read from cache'],
    ['Uncached input', formatTokens(summary.uncachedInput), `${formatTokens(summary.cacheCreationInput)} cache-write tokens separately`],
    ['Output', formatTokens(summary.output), 'includes reasoning & tool output'],
    ['Cache value avoided', formatCurrency(summary.estimatedUncachedValueAvoided ?? summary.cacheSavings), 'Modeled API value, not subscription savings']
  ];
  document.querySelector('#stats-strip').innerHTML = cells.map(([label, value, detail], index) => `<div class="stat-cell" style="--delay:${index * 55}ms"><label>${label}</label><strong>${value}</strong><small class="${index === 4 ? 'positive' : ''}">${detail}</small></div>`).join('');
}

function planLabel(plan) {
  const normalized = String(plan || 'unknown').toLowerCase().replace(/[\s_-]+/g, '');
  const exactLabels = { prolite: 'Pro Lite', pro: 'Pro', plus: 'Plus', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise' };
  return exactLabels[normalized] || String(plan || 'Unknown').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resetLabel(timestamp) {
  if (!timestamp) return 'reset time unavailable';
  const difference = Number(timestamp) * 1000 - Date.now();
  if (difference <= 0) return 'Reset passed · awaiting sync';
  const minutes = Math.floor(difference / 60000);
  if (minutes < 24 * 60) return `resets in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}

function accountAvailability(account) {
  const windows = account.windows || [];
  const known = windows.map((window) => ({ ...window, remaining: windowRemaining(window) })).filter((window) => window.remaining !== null);
  const tightest = known.reduce((lowest, window) => !lowest || window.remaining < lowest.remaining ? window : lowest, null);
  const uncertain = known.length !== windows.length || !known.length;
  const remaining = tightest?.remaining ?? null;
  const stale = Boolean(account.rateStale);
  const tone = remaining === 0 ? 'depleted' : uncertain || stale ? 'unknown' : remaining < 20 ? 'low' : 'ready';
  const label = remaining === 0 ? 'Allowance reached' : stale ? 'Cached allowance' : uncertain ? 'Check allowance' : remaining < 20 ? 'Running low' : 'Headroom available';
  return { known, tightest, remaining, tone, label, uncertain, stale };
}

function limitRing(remaining, tone) {
  return `<div class="allowance-ring ${tone}" role="img" aria-label="${remaining === null ? 'Remaining allowance not reported' : `${displayPercent(remaining)} percent remaining in the lowest reported window`}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-track" cx="60" cy="60" r="51"/><circle class="ring-ticks" cx="60" cy="60" r="59"/><circle class="ring-value" cx="60" cy="60" r="51" pathLength="100" stroke-dasharray="${remaining ?? 0} 100"/></svg><div><strong>${displayPercent(remaining)}${remaining === null ? '' : '<small>%</small>'}</strong><span>${remaining === null ? 'unreported' : 'remaining'}</span></div></div>`;
}

function snapshotAge(timestamp) {
  if (!timestamp) return 'Time not reported';
  const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function renderCommandMetrics() {
  const summary = liveSummary();
  const daily = currentDaily();
  const input = Number(summary.cachedInput || 0) + Number(summary.uncachedInput || 0) + Number(summary.cacheCreationInput || 0);
  const activeDays = daily.filter((point) => currentProviders().some((provider) => dailyTokenValue(point, provider.id) > 0)).length;
  const cells = [
    { label: 'API-equivalent usage', value: formatCurrency(summary.totalCost), detail: `${selectedPeriodLabel()} · estimated token cost`, iconName: 'trend-up', color: 'mint' },
    { label: 'Tokens processed', value: formatTokens(summary.totalTokens), detail: `${formatTokens(summary.totalTokens / Math.max(daily.length, 1))} per calendar day`, iconName: 'layers', color: 'blue' },
    { label: 'Input served from cache', value: input ? `${(Number(summary.cachedInput || 0) / input * 100).toFixed(1)}%` : '—', detail: `${formatTokens(summary.cachedInput)} cached input tokens`, iconName: 'shield', color: 'purple' },
    { label: 'Days with activity', value: `${activeDays}<small> / ${daily.length}</small>`, detail: 'Days with observed token usage', iconName: 'activity', color: 'orange' }
  ];
  document.querySelector('#command-metrics').innerHTML = cells.map((cell) => `<article class="command-metric ${cell.color}"><div><span>${cell.label}</span><span class="icon">${icon(cell.iconName)}</span></div><strong>${cell.value}</strong><small>${cell.detail}</small></article>`).join('');
  const accounts = currentCodexAccounts();
  const availability = accounts.map(accountAvailability);
  const ready = availability.filter((item) => !item.uncertain && !item.stale && item.remaining > 0).length;
  const depleted = availability.filter((item) => item.remaining === 0).length;
  const unknown = availability.filter((item) => item.remaining !== 0 && (item.uncertain || item.stale)).length;
  const resets = accounts.flatMap((account) => (account.windows || []).filter((window) => Number(window.resetsAt) * 1000 > Date.now()).map((window) => ({ ...window, profile: account.profile }))).sort((a, b) => Number(a.resetsAt) - Number(b.resetsAt));
  document.querySelector('#limit-overview').innerHTML = `<div class="availability-summary"><span class="availability-chip ready"><i></i><strong>${ready}</strong> with headroom</span><span class="availability-chip depleted"><i></i><strong>${depleted}</strong> at limit</span>${unknown ? `<span class="availability-chip unknown"><i></i><strong>${unknown}</strong> to check</span>` : ''}<span class="limits-live-note">Current allowances · independent of date range</span></div>${resets.length ? `<div class="reset-timeline"><span class="reset-timeline-label"><span class="icon">${icon('clock')}</span> Upcoming resets</span>${resets.slice(0, 3).map((window, index) => `<div class="reset-event"><i>${String(index + 1).padStart(2, '0')}</i><span><strong>${escapeHtml(window.profile)} <b>${escapeHtml(window.tag)}</b></strong><small>${escapeHtml(formatResetDate(window.resetsAt))}</small></span></div>`).join('')}</div>` : '<div class="reset-timeline empty-copy">Reset times appear when reported by an account.</div>'}`;
  document.querySelector('#account-limit-summary').textContent = `${accounts.length} accounts · lowest reported window per gauge`;
  document.querySelector('#codex-count').textContent = accounts.length;
  document.querySelector('#connection-title').textContent = state.syncError ? 'Sync unavailable · showing last snapshot' : state.snapshot.mode === 'loading' ? 'Reading local usage' : state.snapshot.mode === 'preview data' ? 'Preview data · awaiting local connection' : 'Your local usage, connected';
  document.querySelector('.connection-banner').classList.toggle('is-preview', Boolean(state.syncError) || state.snapshot.mode === 'preview data');
}

function renderCodexAccounts() {
  const accounts = currentCodexAccounts();
  document.querySelector('#codex-accounts-grid').innerHTML = accounts.map((account, index) => {
    const { remaining, tone, label, tightest, uncertain } = accountAvailability(account);
    const credits = account.credits?.unlimited ? 'Unlimited' : account.credits?.hasCredits && account.credits.balance != null ? formatCompact(Number(account.credits.balance), 2) : 'None reported';
    const banked = account.bankedResets != null && Number.isFinite(Number(account.bankedResets)) ? formatCompact(account.bankedResets, 0) : 'Not reported';
    const planIsFallback = account.planSource !== 'providerReported';
    const status = account.rateStale ? 'Cached limits' : account.exact ? 'Provider reported' : 'Partial snapshot';
    return `<article class="codex-account-card subscription-card ${tone}" style="--delay:${index * 70}ms"><div class="subscription-top"><div class="codex-account-identity"><span class="account-number">C${index + 1}</span><span class="codex-account-copy"><strong>${escapeHtml(account.profile)}</strong><small>Codex account ${String(index + 1).padStart(2, '0')}</small></span></div><span class="codex-plan-pill ${planIsFallback ? 'is-fallback' : ''}" title="${planIsFallback ? 'Configured plan; not verified by provider' : 'Provider-reported subscription'}">${escapeHtml(planLabel(account.plan))}${planIsFallback ? ' · configured' : ''}</span></div><div class="subscription-hero">${limitRing(remaining, tone)}<div class="allowance-copy"><span class="allowance-state ${tone}"><i></i>${label}</span><strong>${escapeHtml(tightest?.label || 'No current window')}</strong><p>${remaining === 0 ? 'This window has no allowance left.' : uncertain ? 'One or more limits need a fresh snapshot.' : 'Each window has its own allowance.'}</p><span class="snapshot-source">${status} · ${snapshotAge(account.rateFetchedAt)}</span></div></div><div class="codex-window-list">${(account.windows || []).map((window) => {
      const value = windowRemaining(window);
      const windowTone = value === null ? 'unknown' : value < 20 ? 'low' : 'ready';
      return `<div class="codex-window ${windowTone}"><div class="codex-window-top"><span class="codex-window-name"><i class="codex-window-tag">${escapeHtml(window.tag)}</i>${escapeHtml(window.label)}</span><strong class="codex-window-remaining">${value === null ? 'Not reported' : `${displayPercent(value)}% left`}</strong></div><div class="codex-window-track" role="${value === null ? 'img' : 'meter'}" aria-label="${escapeHtml(window.label)} remaining" ${value === null ? '' : `aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"`}><span style="--remaining:${value ?? 0}%"></span></div><div class="codex-window-meta"><span>${value === null ? 'Awaiting fresh limit' : `${100 - displayPercent(value)}% used`}</span><span>${escapeHtml(resetLabel(window.resetsAt))}</span></div>${window.resetsAt ? `<time class="window-exact-reset">${escapeHtml(formatResetDate(window.resetsAt))}</time>` : ''}</div>`;
    }).join('') || '<p class="empty-copy">No allowance reported. Sync to check for an update.</p>'}</div><div class="subscription-facts"><div><span>Selected-period tokens</span><strong>${account.usageExact === false && !account.usageStale ? 'Not reported' : formatTokens(account.rangeTokens)}</strong>${account.usageStale ? '<small>Cached usage</small>' : ''}</div><div><span>Usage credits</span><strong>${credits}</strong></div></div><div class="subscription-foot"><span>Banked resets <b>${banked}</b></span><span>${account.connected ? 'Account detected' : 'Account unavailable'}</span></div></article>`;
  }).join('') || '<p class="empty-copy">No Codex accounts detected.</p>';
}

function renderLimits() {
  const providers = currentProviders().filter((provider) => provider.id !== 'codex');
  document.querySelector('#limits-grid').innerHTML = providers.map((provider) => {
    const meta = providerLimits(provider.id);
    const limits = meta.limits || [];
    return `<article class="limit-card provider-limit" style="--provider-color:${provider.color}"><div class="limit-card-top"><div class="limit-provider">${renderProviderGlyph(provider.id)}<span class="limit-provider-copy"><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(meta.note || 'Local adapter')}</small></span></div><span class="plan-pill">${escapeHtml(meta.plan || 'Not reported')}</span></div>${limits.length ? `<div class="limit-rows">${limits.map((limit) => {
      const remaining = windowRemaining(limit, 'remaining');
      return `<div class="limit-row"><div class="limit-row-head"><span>${escapeHtml(limit.label)}</span><strong>${remaining === null ? 'Not reported' : `${displayPercent(remaining)}% left`}</strong></div><div class="limit-track"><span style="--remaining:${remaining ?? 0}%"></span></div><div class="limit-row-meta"><span>${escapeHtml(limit.tag)} WINDOW</span><span>${escapeHtml(limit.resetsAt ? resetLabel(limit.resetsAt) : limit.reset || 'Reset not reported')}</span></div></div>`;
    }).join('')}</div>` : `<div class="provider-unknown"><span class="unknown-mini">—</span><div><strong>${meta.unlimited ? 'Provider-managed limits' : 'Allowance not reported'}</strong><p>${escapeHtml(meta.message || 'Limits are set by the connected API provider. No remaining allowance was reported locally.')}</p></div></div>`}</article>`;
  }).join('');
}

function miniSparkline(providerId) {
  const points = currentDaily().slice(-30).map((point) => dailyTokenValue(point, providerId));
  const max = Math.max(1, ...points);
  const path = points.map((value, index) => `${index ? 'L' : 'M'} ${(index / Math.max(1, points.length - 1) * 62).toFixed(1)} ${(21 - value / max * 18).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 62 24" role="img" aria-label="Observed daily tokens, last ${points.length} days" style="--provider-color:${providerMeta[providerId].color}"><path d="${path}"></path></svg>`;
}

function renderAccounts() {
  document.querySelector('#account-grid').innerHTML = currentProviders().map((provider, index) => `<article class="account-card" style="--provider-color:${provider.color};--delay:${index * 70}ms" data-provider-card="${provider.id}"><div class="account-card-top">${renderProviderGlyph(provider.id)}<span class="account-status ${provider.status === 'unavailable' ? 'unavailable' : ''}"><i class="status-dot"></i>${provider.status === 'unavailable' ? 'No local data' : 'Detected'}</span></div><h3>${escapeHtml(provider.name)}</h3><p class="account-subtitle">${escapeHtml(provider.source)}</p><div class="account-metric"><div><strong>${formatCurrency(provider.cost)}</strong><small> API estimate</small></div>${miniSparkline(provider.id)}</div><div class="account-bottom"><span>${provider.sessions == null ? 'Sessions unreported' : `${provider.sessions} observed sessions`}</span><span>${formatTokens(provider.tokens)} tokens</span></div></article>`).join('');
}

function filteredModels() {
  const providers = currentProviders();
  const availableModels = currentModels();
  const costByProvider = Object.fromEntries(providers.map((provider) => [provider.id, provider.cost]));
  const tokenByProvider = Object.fromEntries(providers.map((provider) => [provider.id, provider.tokens]));
  const baseCostByProvider = {};
  const baseTokenByProvider = {};
  for (const providerId of Object.keys(providerMeta)) {
    baseCostByProvider[providerId] = 0;
    baseTokenByProvider[providerId] = 0;
  }
  for (const model of availableModels) {
    if (baseCostByProvider[model.provider] === undefined) continue;
    baseCostByProvider[model.provider] += model.cost;
    baseTokenByProvider[model.provider] += model.tokens;
  }
  const totalCostAcrossProviders = Object.values(costByProvider).reduce((sum, cost) => sum + cost, 0);
  const query = state.query.toLowerCase();
  return availableModels.filter((model) => (state.filter === 'all' || model.provider === state.filter) && (!query || model.name.toLowerCase().includes(query) || providerMeta[model.provider].name.toLowerCase().includes(query))).map((model) => {
    const costScale = (costByProvider[model.provider] || 0) / Math.max(baseCostByProvider[model.provider] || 1, 1);
    const tokenScale = (tokenByProvider[model.provider] || 0) / Math.max(baseTokenByProvider[model.provider] || 1, 1);
    const scaledCost = model.cost * costScale;
    const scaledTokens = model.tokens * tokenScale;
    return { ...model, cost: scaledCost, tokens: scaledTokens, share: scaledCost / Math.max(totalCostAcrossProviders, 1) * 100, providerCost: costByProvider[model.provider], providerTokens: tokenByProvider[model.provider] };
  });
}

function renderBreakdown() {
  const header = document.querySelector('#breakdown thead tr');
  if (header) header.innerHTML = `<th>${state.tableMode === 'day' ? 'Day / provider' : 'Model / provider'}</th><th>API estimate</th><th>Share</th><th>Tokens</th><th></th>`;
  if (state.tableMode === 'day') {
    const providers = currentProviders().filter((provider) => state.filter === 'all' || provider.id === state.filter);
    const days = currentDaily().slice().reverse().filter((point) => !state.query || `${point.date} ${formatDate(point.date)}`.toLowerCase().includes(state.query.toLowerCase()));
    const values = days.map((point) => ({ date: point.date, cost: providers.reduce((sum, provider) => sum + (Number(point[provider.id]) || 0), 0), tokens: providers.reduce((sum, provider) => sum + dailyTokenValue(point, provider.id), 0) }));
    const total = values.reduce((sum, day) => sum + day.cost, 0);
    document.querySelector('#breakdown-body').innerHTML = (state.expandedModels ? values : values.slice(0, 6)).map((day) => `<tr><td><div class="model-cell"><span class="icon">${icon('activity')}</span><span class="model-copy"><strong>${formatDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><small>${escapeHtml(state.filter === 'all' ? 'All providers' : providerMeta[state.filter]?.name)}</small></span></div></td><td class="cost">${formatCurrency(day.cost)}</td><td class="share">${total ? (day.cost / total * 100).toFixed(1) : '0.0'}%</td><td>${formatTokens(day.tokens)}</td><td></td></tr>`).join('') || '<tr><td colspan="5">No days match this filter.</td></tr>';
    document.querySelector('#load-more').textContent = state.expandedModels ? `Showing ${values.length} days · show fewer` : `View all ${values.length} days`;
    return;
  }
  const rows = filteredModels();
  const visibleRows = state.expandedModels ? rows : rows.slice(0, 6);
  document.querySelector('#breakdown-body').innerHTML = visibleRows.length ? visibleRows.map((model) => `<tr><td><div class="model-cell">${renderProviderGlyph(model.provider)}<span class="model-copy"><strong>${escapeHtml(model.name)}</strong><small>${providerMeta[model.provider].name}</small></span></div></td><td class="cost">${formatCurrency(model.cost)}</td><td class="share">${model.share.toFixed(1)}%</td><td>${formatTokens(model.tokens)}</td><td><span class="model-share-meter" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, model.share))}%"></i></span></td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:25px;color:var(--muted);font-family:Manrope,sans-serif">No models match that filter.</td></tr>';
  document.querySelector('#load-more').innerHTML = state.expandedModels || rows.length <= 6 ? `Showing ${rows.length} model${rows.length === 1 ? '' : 's'} <span class="icon" data-icon="check"></span>` : `View all ${rows.length} models <span class="icon" data-icon="arrow-right"></span>`;
  hydrateIcons(document.querySelector('#breakdown-body'));
  hydrateIcons(document.querySelector('#load-more'));
}

function renderPipeline() {
  document.querySelector('#pipeline').innerHTML = currentProviders().map((provider) => `<div class="pipeline-row"><span>${renderProviderGlyph(provider.id)}</span><span class="pipeline-copy"><strong>${escapeHtml(provider.shortName)}</strong><small>${provider.status === 'unavailable' ? 'No local usage source' : escapeHtml(provider.source)}</small></span><span class="pipeline-check">${icon(provider.status === 'unavailable' ? 'info' : 'check')}</span></div>`).join('');
  const detected = currentProviders().filter((provider) => ['detected', 'connected'].includes(provider.status)).length;
  document.querySelector('#pulse-count').textContent = String(detected).padStart(2, '0');
  document.querySelector('#connected-count').textContent = detected;
}

function renderActivity() {
  const daily = currentDaily().filter((point) => currentProviders().some((provider) => dailyTokenValue(point, provider.id) > 0)).slice(-5).reverse();
  document.querySelector('#activity-list').innerHTML = daily.map((point) => {
    const providers = currentProviders().map((provider) => ({ ...provider, value: dailyTokenValue(point, provider.id) })).filter((provider) => provider.value > 0).sort((a, b) => b.value - a.value);
    const tokens = providers.reduce((sum, provider) => sum + provider.value, 0);
    const cost = currentProviders().reduce((sum, provider) => sum + (Number(point[provider.id]) || 0), 0);
    return `<div class="activity-item"><span class="activity-icon" style="--activity-color:${providers[0]?.color || '#77e4c5'}">${icon('activity')}</span><span class="activity-copy"><strong>${formatTokens(tokens)} tokens observed</strong><small>${formatCurrency(cost)} API estimate · ${providers.length} provider${providers.length === 1 ? '' : 's'}</small></span><span class="activity-time">${formatDate(point.date)}</span></div>`;
  }).join('') || '<p class="empty-copy">No daily activity in this period.</p>';
}

function renderInsights() {
  window.renderUsageInsights?.({ daily: currentDaily(), providers: currentProviders(), summary: state.snapshot.summary || {}, models: currentModels(), rangeLabel: selectedPeriodLabel(), metric: state.metric, formatTokens, formatCurrency, escapeHtml });
}

function renderAttention() {
  const headroom = currentHeadroom().slice(0, 3);
  const credits = creditSummary();
  const notifications = notificationItems();
  const actionable = notifications.filter((item) => item.level !== 'info');
  const headroomRows = headroom.length ? headroom.map((window) => `<div class="headroom-row"><div><span>${escapeHtml(window.provider)} · ${escapeHtml(window.label)}</span><small>${escapeHtml(window.reset)}</small></div><strong class="${window.remaining !== null && window.remaining < 20 ? 'is-low' : ''}">${displayPercent(window.remaining)}%</strong><div class="headroom-track"><span style="width:${Math.max(0, window.remaining)}%"></span></div></div>`).join('') : '<p class="empty-copy">No hosted usage windows reported.</p>';
  const alertPreview = actionable.slice(0, 2).map((item) => `<div class="attention-alert ${item.level}"><span class="icon">${icon(item.icon)}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span></div>`).join('') || `<div class="attention-clear"><span class="icon">${icon('check')}</span><span><strong>No urgent alerts</strong><small>${headroom.length ? 'No reported window is critically low.' : 'No current allowance is reported.'}</small></span></div>`;
  document.querySelector('#attention-grid').innerHTML = `<article class="attention-card"><div class="attention-card-head"><span><i class="attention-kicker">Headroom</i><strong>Lowest limits</strong></span><button type="button" data-scroll-target="#limits">Review</button></div><div class="headroom-list">${headroomRows}</div></article><article class="attention-card"><div class="attention-card-head"><span><i class="attention-kicker">Balances</i><strong>Provider-reported</strong></span><button type="button" data-scroll-target="#limits">Details</button></div><div class="balance-pair"><div><span>Banked resets</span><strong>${credits.bankedResets === null ? 'Not reported' : formatCompact(credits.bankedResets, 0)}</strong><small>Only shown when a provider supplies it</small></div><div><span>Usage credits available</span><strong>${credits.usageCredits > 0 ? formatCompact(credits.usageCredits, 2) : 'None reported'}</strong><small>Current provider balance</small></div></div></article><article class="attention-card"><div class="attention-card-head"><span><i class="attention-kicker">Alerts</i><strong>${actionable.length ? `${actionable.length} need review` : 'Nothing urgent'}</strong></span><button type="button" data-open-notifications>Open all</button></div><div class="attention-alerts">${alertPreview}</div></article>`;
  hydrateIcons(document.querySelector('#attention-grid'));
}

function renderNotifications() {
  const items = notificationItems();
  const unread = unreadNotifications();
  const list = document.querySelector('#notification-list');
  list.innerHTML = items.length ? items.map((item) => `<button class="notification-item ${item.level} ${state.readNotifications.has(item.id) ? 'is-read' : ''}" type="button" data-notification-id="${item.id}" data-target="${item.target}"><span class="notification-icon">${icon(item.icon)}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><i></i></button>`).join('') : '<div class="notification-empty"><span class="icon">' + icon('check') + '</span><strong>You are all caught up</strong><small>No alerts or sync events are available.</small></div>';
  document.querySelector('#notification-summary').textContent = unread.length ? `${unread.length} unread notification${unread.length === 1 ? '' : 's'}` : 'No unread notifications';
  document.querySelector('#notification-dot').classList.toggle('is-hidden', unread.length === 0);
  document.querySelector('#nav-alert-count').textContent = String(items.filter((item) => item.level !== 'info').length).padStart(2, '0');
}

function renderWorkspace() {
  const workspace = activeWorkspace();
  document.querySelector('.workspace-avatar').textContent = workspace.initials || workspaceInitials(workspace.name);
  document.querySelector('.workspace-copy strong').textContent = workspace.name;
  document.querySelector('.workspace-copy small').textContent = workspace.type;
  document.querySelector('#workspace-list').innerHTML = state.workspaces.map((item) => `<button class="workspace-option ${item.id === workspace.id ? 'active' : ''}" type="button" data-workspace-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.initials || workspaceInitials(item.name))}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)}</small></span>${item.id === workspace.id ? icon('check') : ''}</button>`).join('');
  document.querySelector('#compact-workspace-name').textContent = workspace.name;
}

function renderSettings() {
  document.querySelector('#poll-interval').value = String(state.settings.pollSeconds);
  document.querySelector('#notify-critical').checked = Boolean(state.settings.notifyCritical);
  document.querySelector('#notify-sync').checked = Boolean(state.settings.notifySync);
  document.querySelector('#compact-default').checked = Boolean(state.settings.compactDefault);
}

function renderCompactView() {
  const summary = liveSummary();
  const accountLimits = currentAccountLimits();
  const actionableAlerts = notificationItems().filter((item) => item.level !== 'info');
  const alerts = actionableAlerts.slice(0, 2);
  document.body.classList.toggle('compact-mode', state.compactMode);
  document.querySelector('#compact-total').textContent = formatCurrency(summary.totalCost);
  document.querySelector('#compact-period').textContent = `${selectedPeriodLabel()} · API estimate`;
  document.querySelector('#compact-status').innerHTML = `<div><span>Processed tokens</span><strong>${formatTokens(summary.processedTokens)}</strong></div><div><span>Cache savings</span><strong>${formatCurrency(summary.estimatedUncachedValueAvoided ?? summary.cacheSavings)}</strong></div><div><span>Sessions</span><strong>${summary.activeSessions || 0}</strong></div>`;
  document.querySelector('#compact-limits-title').textContent = 'Account limits';
  document.querySelector('#compact-headroom').innerHTML = accountLimits.length ? accountLimits.map((account, accountIndex) => `<div class="compact-account-limit"><div class="compact-account-identity"><span>C${accountIndex + 1}</span><span><strong>${escapeHtml(account.profile)}</strong><small>${escapeHtml(account.plan)}</small></span></div><div class="compact-account-windows">${account.windows.length ? account.windows.map((window) => `<div class="compact-window-limit"><div class="compact-window-line"><span><i>${escapeHtml(window.tag)}</i><small>${escapeHtml(window.reset)}</small></span><b class="${window.remaining !== null && window.remaining < 20 ? 'is-low' : ''}">${window.remaining === null ? '—' : `${window.displayRemaining}%`}</b></div><div class="compact-window-meter ${window.remaining !== null && window.remaining < 20 ? 'is-low' : ''}"><span style="width:${window.remaining ?? 0}%"></span></div></div>`).join('') : '<small class="compact-unreported">No current limit reported</small>'}</div></div>`).join('') : '<p class="empty-copy">No account limits reported.</p>';
  document.querySelector('#compact-alerts').innerHTML = alerts.length ? alerts.map((item) => `<button class="compact-alert ${item.level}" type="button" data-target="${item.target}"><span class="icon">${icon(item.icon)}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span></button>`).join('') : '<div class="compact-clear"><span class="icon">' + icon('check') + '</span><span>Nothing needs attention</span></div>';
  hydrateIcons(document.querySelector('#compact-dashboard'));
  reportTrayStatus();
}

// The menu-bar title has to stay current even when the popover is not on
// screen, so this is deliberately independent of the dashboard render.
function reportTrayStatus() {
  if (!isDesktopTraySurface || !window.pulseDesktop) return;
  const accountLimits = currentAccountLimits();
  const accountWindows = accountLimits.flatMap((account) => account.windows);
  let lowestRemaining = null;
  for (const limitWindow of accountWindows) {
    if (limitWindow.remaining !== null && (lowestRemaining === null || limitWindow.remaining < lowestRemaining)) lowestRemaining = limitWindow.remaining;
  }
  window.pulseDesktop.reportTrayStatus({
    lowestRemaining,
    accounts: accountLimits,
    warningCount: notificationItems().filter((item) => item.level !== 'info').length,
    paused: state.paused,
    fetchedAt: Number(state.snapshot.fetchedAt) || Date.now()
  });
}

let hasRendered = false;
let renderQueued = false;
// The desktop tray window disables background throttling, which pins
// document.visibilityState to 'visible'; the main process reports the real
// state instead. In a plain browser the Page Visibility API is authoritative.
let desktopSurfaceVisible = null;

function isSurfaceVisible() {
  return desktopSurfaceVisible === null ? !document.hidden : desktopSurfaceVisible;
}

function flushDeferredRender() {
  if (renderQueued && isSurfaceVisible()) renderAll();
}

function renderAll() {
  // Both desktop surfaces stay loaded while hidden and keep polling. Rebuilding
  // every section's markup for a window nobody can see is pure overhead, so the
  // work is deferred until it becomes visible again. The first render always
  // runs so a hidden window still has a populated DOM.
  if (hasRendered && !isSurfaceVisible()) {
    renderQueued = true;
    reportTrayStatus();
    return;
  }
  renderQueued = false;
  hasRendered = true;
  renderSummary();
  renderStats();
  renderCommandMetrics();
  renderInsights();
  renderAttention();
  renderCodexAccounts();
  renderLimits();
  renderAccounts();
  renderBreakdown();
  renderPipeline();
  renderActivity();
  renderChart();
  renderNotifications();
  renderWorkspace();
  renderSettings();
  renderCompactView();
  hydrateIcons();
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  document.querySelector('#toast-copy').textContent = message;
  toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function updateSyncLabels() {
  const elapsed = Math.max(0, Math.floor((Date.now() - (state.snapshot.fetchedAt || Date.now())) / 1000));
  const label = elapsed < 5 ? 'Updated just now' : elapsed < 60 ? `Updated ${elapsed}s ago` : `Updated ${Math.floor(elapsed / 60)}m ago`;
  document.querySelector('#topbar-sync-label').textContent = state.syncError ? 'Sync unavailable' : state.snapshot.mode === 'loading' ? 'Reading local sources…' : label;
  const time = new Date(state.snapshot.fetchedAt || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  document.querySelector('#last-sync-text').textContent = state.snapshot.fetchedAt ? `LAST SYNC ${time}` : 'WAITING FOR FIRST SYNC';
  document.querySelector('#next-poll').textContent = formatCountdown(state.secondsToPoll);
  document.querySelector('#compact-next-poll').textContent = formatCountdown(state.secondsToPoll);
  document.querySelector('#compact-sync-label').textContent = state.paused ? 'Live sync paused' : label;
  document.querySelector('#live-toggle span:nth-child(2)').textContent = state.paused ? 'Polling paused' : 'Live mode';
  document.querySelector('.sidebar-status strong').textContent = state.syncError ? 'Sync unavailable' : state.paused ? 'Local sync paused' : 'Local sync online';
  document.querySelector('.sidebar-status small').textContent = state.paused ? 'Resume to refresh sources' : `Polling every ${state.settings.pollSeconds} sec`;
}

function setSyncing(value) {
  state.syncing = value;
  document.querySelector('#sync-button').classList.toggle('is-syncing', value);
  document.querySelector('#topbar-refresh').classList.toggle('is-syncing', value);
  document.querySelector('#compact-sync').classList.toggle('is-syncing', value);
  document.querySelector('#sync-button span:last-child').textContent = value ? 'Syncing' : 'Sync all';
}

function preserveLastValidAccountUsage(payload) {
  if (!Array.isArray(payload.codexAccounts) || payload.rangeDays !== state.snapshot.rangeDays) return payload;
  const previousAccounts = new Map(currentCodexAccounts().map((account) => [account.id, account]));
  const codexAccounts = payload.codexAccounts.map((account) => {
    const previous = previousAccounts.get(account.id);
    if (account.usageExact !== false || !previous || Number(previous.rangeTokens) <= 0 || !previous.usageFetchedAt || Date.now() - previous.usageFetchedAt > 24 * 60 * 60 * 1000) return account;
    return {
      ...account,
      rangeTokens: previous.rangeTokens,
      baselineTokens: previous.baselineTokens,
      lifetimeTokens: previous.lifetimeTokens,
      usageFetchedAt: previous.usageFetchedAt,
      usageStale: true
    };
  });
  return { ...payload, codexAccounts };
}

async function syncUsage({ quiet = false } = {}) {
  if (state.syncing) return;
  const requestedRange = state.range;
  setSyncing(true);
  try {
    const response = await fetch(`/api/usage?days=${requestedRange}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Usage endpoint unavailable');
    const payload = preserveLastValidAccountUsage(await response.json());
    if (state.range !== requestedRange) return;
    state.snapshot = payload;
    state.syncError = false;
    renderAll();
    if (!quiet) showToast(payload.mode.includes('session cache') ? 'Local usage cache synced' : 'All providers synced');
  } catch (error) {
    if (state.range !== requestedRange) return;
    state.syncError = true;
    if (state.snapshot.fetchedAt) {
      state.range = state.snapshot.rangeKey || state.snapshot.rangeDays;
      document.querySelectorAll('[data-range]').forEach((button) => button.classList.toggle('active', String(state.range) === button.dataset.range));
    }
    renderAll();
    if (!quiet) showToast('Sync unavailable. Keeping the last snapshot; try again shortly.');
  } finally {
    state.secondsToPoll = state.settings.pollSeconds;
    setSyncing(false);
    updateSyncLabels();
    if (state.range !== requestedRange) syncUsage({ quiet: true });
  }
}

function setPanel(panelId = null) {
  const panels = ['notifications-panel', 'settings-panel'];
  panels.forEach((id) => {
    const panel = document.querySelector(`#${id}`);
    const isOpen = id === panelId;
    panel.hidden = !isOpen;
    const control = id === 'notifications-panel' ? document.querySelector('#notifications-button') : document.querySelector('#settings-button');
    control?.setAttribute('aria-expanded', String(isOpen));
  });
  document.querySelector('#panel-scrim').hidden = !panelId;
  document.body.classList.toggle('panel-open', Boolean(panelId));
}

function setCompactMode(value) {
  state.compactMode = Boolean(value);
  setPanel(null);
  document.querySelector('#workspace-menu').hidden = true;
  document.querySelector('#workspace-switcher').setAttribute('aria-expanded', 'false');
  renderCompactView();
  if (state.compactMode) document.querySelector('#compact-sync').focus();
}

function saveSettings() {
  writeStored('usage-pulse-settings', state.settings);
  state.secondsToPoll = state.settings.pollSeconds;
  renderSettings();
  renderNotifications();
  renderAttention();
  renderCompactView();
  updateSyncLabels();
}

function openTarget(selector) {
  if (isDesktopTraySurface && window.pulseDesktop) {
    window.pulseDesktop.openMainWindow(selector);
    return;
  }
  setPanel(null);
  setCompactMode(false);
  const target = document.querySelector(selector);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', selector);
  }
}

function setupNavigation() {
  const links = [...document.querySelectorAll('.nav-list a[href^="#"]')];
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  links.forEach((link) => link.addEventListener('click', () => {
    links.forEach((item) => item.classList.toggle('active', item === link));
  }));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
  }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, .2, .5] });
  sections.forEach((section) => observer.observe(section));
}

function setupChartTooltip() {
  const area = document.querySelector('#chart-area');
  const tooltip = document.querySelector('#chart-tooltip');
  const line = document.querySelector('#chart-hover-line');
  area.addEventListener('mousemove', (event) => {
    const rect = area.getBoundingClientRect();
    const svgRect = document.querySelector('#usage-chart').getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(svgRect.width, event.clientX - svgRect.left));
    const points = currentDaily();
    if (!points.length || !svgRect.width) return;
    const index = Math.min(points.length - 1, Math.max(0, Math.round(offsetX / svgRect.width * (points.length - 1))));
    const point = points[index];
    const providers = currentProviders();
    const values = providers.map((provider) => chartValue(point, provider.id));
    line.setAttribute('x1', offsetX * 760 / svgRect.width);
    line.setAttribute('x2', offsetX * 760 / svgRect.width);
    line.setAttribute('opacity', '1');
    tooltip.innerHTML = `<div class="tooltip-date">${formatDate(point.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>${providers.map((provider, providerIndex) => `<div class="tooltip-row"><span class="tooltip-label"><i class="legend-dot" style="background:${provider.color}"></i>${provider.shortName}</span><b>${state.metric === 'cost' ? formatCurrency(values[providerIndex]) : formatTokens(values[providerIndex])}</b></div>`).join('')}`;
    tooltip.hidden = false;
    const tooltipWidth = 145;
    const left = Math.max(3, Math.min(rect.width - tooltipWidth - 3, event.clientX - rect.left + 12));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 40)}px`;
  });
  area.addEventListener('mouseleave', () => { tooltip.hidden = true; line.setAttribute('opacity', '0'); });
}

function setupInteractions() {
  document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
    state.range = button.dataset.range === 'lifetime' ? 'lifetime' : Number(button.dataset.range);
    document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('active', item === button));
    syncUsage({ quiet: true });
  }));
  document.querySelectorAll('[data-metric]').forEach((button) => button.addEventListener('click', () => {
    state.metric = button.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach((item) => item.classList.toggle('active', item === button));
    renderSummary();
    renderChart();
    renderInsights();
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderBreakdown();
  }));
  document.querySelectorAll('[data-table-mode]').forEach((button) => button.addEventListener('click', () => {
    state.tableMode = button.dataset.tableMode;
    document.querySelectorAll('[data-table-mode]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelector('#model-search').placeholder = state.tableMode === 'day' ? 'Filter dates' : 'Filter models';
    renderBreakdown();
    showToast(state.tableMode === 'model' ? 'Showing model breakdown' : 'Showing daily usage');
  }));
  document.querySelector('#model-search').addEventListener('input', (event) => { state.query = event.target.value; renderBreakdown(); });
  document.querySelector('#load-more').addEventListener('click', () => { state.expandedModels = !state.expandedModels; renderBreakdown(); });
  document.querySelector('#sync-button').addEventListener('click', () => syncUsage());
  document.querySelector('#topbar-refresh').addEventListener('click', () => syncUsage());
  document.querySelector('#compact-sync').addEventListener('click', () => syncUsage());
  document.querySelector('#pause-live').addEventListener('click', () => {
    state.paused = !state.paused;
    document.querySelector('#pause-live').innerHTML = icon(state.paused ? 'activity' : 'pause');
    showToast(state.paused ? 'Live polling paused' : 'Live polling resumed');
  });
  document.querySelector('#live-toggle').addEventListener('click', () => document.querySelector('#pause-live').click());
  document.querySelector('#manage-accounts').addEventListener('click', () => openTarget('#limits'));
  document.querySelector('#limit-help').addEventListener('click', () => {
    setPanel('settings-panel');
    document.querySelector('#limit-definitions').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.querySelector('#view-activity').addEventListener('click', () => openTarget('#usage-insights'));

  const workspaceMenu = document.querySelector('#workspace-menu');
  const workspaceSwitcher = document.querySelector('#workspace-switcher');
  workspaceSwitcher.addEventListener('click', () => {
    const willOpen = workspaceMenu.hidden;
    setPanel(null);
    workspaceMenu.hidden = !willOpen;
    workspaceSwitcher.setAttribute('aria-expanded', String(willOpen));
  });
  document.querySelector('#workspace-list').addEventListener('click', (event) => {
    const option = event.target.closest('[data-workspace-id]');
    if (!option) return;
    state.activeWorkspaceId = option.dataset.workspaceId;
    writeStored('usage-pulse-active-workspace', state.activeWorkspaceId);
    workspaceMenu.hidden = true;
    workspaceSwitcher.setAttribute('aria-expanded', 'false');
    renderWorkspace();
    showToast(`Switched to ${activeWorkspace().name}`);
  });

  const workspaceDialog = document.querySelector('#workspace-dialog');
  const closeWorkspaceDialog = () => { if (workspaceDialog.open) workspaceDialog.close(); };
  document.querySelector('#add-workspace').addEventListener('click', () => {
    workspaceMenu.hidden = true;
    workspaceSwitcher.setAttribute('aria-expanded', 'false');
    workspaceDialog.showModal();
    document.querySelector('#workspace-name').focus();
  });
  document.querySelector('#close-workspace-dialog').addEventListener('click', closeWorkspaceDialog);
  document.querySelector('#cancel-workspace').addEventListener('click', closeWorkspaceDialog);
  document.querySelector('#workspace-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.querySelector('#workspace-name').value.trim();
    const type = document.querySelector('#workspace-type').value;
    if (!name) return;
    const workspace = { id: `workspace-${Date.now()}`, name, type, initials: workspaceInitials(name) };
    state.workspaces.push(workspace);
    state.activeWorkspaceId = workspace.id;
    writeStored('usage-pulse-workspaces', state.workspaces);
    writeStored('usage-pulse-active-workspace', state.activeWorkspaceId);
    event.currentTarget.reset();
    closeWorkspaceDialog();
    renderWorkspace();
    showToast(`${name} workspace created`);
  });

  const toggleNotifications = () => setPanel(document.querySelector('#notifications-panel').hidden ? 'notifications-panel' : null);
  document.querySelector('#notifications-button').addEventListener('click', toggleNotifications);
  document.querySelector('#open-alerts').addEventListener('click', toggleNotifications);
  document.querySelector('#compact-open-alerts').addEventListener('click', () => {
    if (isDesktopTraySurface) openTarget('#attention');
    else { setCompactMode(false); setPanel('notifications-panel'); }
  });
  document.querySelector('#mark-all-read').addEventListener('click', () => {
    notificationItems().forEach((item) => state.readNotifications.add(item.id));
    writeStored('usage-pulse-read-notifications', [...state.readNotifications]);
    renderNotifications();
    showToast('All notifications marked as read');
  });
  document.querySelector('#notification-list').addEventListener('click', (event) => {
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    state.readNotifications.add(item.dataset.notificationId);
    writeStored('usage-pulse-read-notifications', [...state.readNotifications]);
    renderNotifications();
    openTarget(item.dataset.target);
  });

  document.querySelector('#settings-button').addEventListener('click', () => setPanel(document.querySelector('#settings-panel').hidden ? 'settings-panel' : null));
  document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', () => setPanel(null)));
  document.querySelector('#panel-scrim').addEventListener('click', () => setPanel(null));
  document.querySelector('#value-help').addEventListener('click', () => {
    setPanel('settings-panel');
    document.querySelector('#value-definitions').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelector('#poll-interval').addEventListener('change', (event) => { state.settings.pollSeconds = Number(event.target.value); saveSettings(); showToast(`Polling every ${event.target.selectedOptions[0].textContent.toLowerCase()}`); });
  document.querySelector('#notify-critical').addEventListener('change', (event) => { state.settings.notifyCritical = event.target.checked; saveSettings(); });
  document.querySelector('#notify-sync').addEventListener('change', (event) => { state.settings.notifySync = event.target.checked; saveSettings(); });
  document.querySelector('#compact-default').addEventListener('change', (event) => { state.settings.compactDefault = event.target.checked; saveSettings(); });
  document.querySelector('#reset-settings').addEventListener('click', () => { state.settings = { ...defaultSettings }; saveSettings(); showToast('Default settings restored'); });

  const openCompact = () => setCompactMode(true);
  document.querySelector('#compact-view-button').addEventListener('click', openCompact);
  document.querySelector('#sidebar-compact-button').addEventListener('click', openCompact);
  document.querySelector('#enter-compact').addEventListener('click', openCompact);
  document.querySelector('#exit-compact').addEventListener('click', () => {
    if (isDesktopTraySurface) openTarget('#overview');
    else setCompactMode(false);
  });
  document.querySelector('#compact-open-limits').addEventListener('click', (event) => { event.preventDefault(); openTarget('#limits'); });
  document.querySelector('#compact-alerts').addEventListener('click', (event) => {
    const alert = event.target.closest('[data-target]');
    if (alert) openTarget(alert.dataset.target);
  });

  document.querySelector('#attention-grid').addEventListener('click', (event) => {
    const targetButton = event.target.closest('[data-scroll-target]');
    if (targetButton) openTarget(targetButton.dataset.scrollTarget);
    if (event.target.closest('[data-open-notifications]')) toggleNotifications();
  });
  document.addEventListener('click', (event) => {
    if (!workspaceMenu.hidden && !workspaceMenu.contains(event.target) && !workspaceSwitcher.contains(event.target)) {
      workspaceMenu.hidden = true;
      workspaceSwitcher.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setPanel(null);
      workspaceMenu.hidden = true;
      workspaceSwitcher.setAttribute('aria-expanded', 'false');
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      setCompactMode(!state.compactMode);
    }
  });
}

function startPolling() {
  setInterval(() => {
    if (!state.paused) {
      state.secondsToPoll -= 1;
      if (state.secondsToPoll <= 0) { state.secondsToPoll = state.settings.pollSeconds; syncUsage({ quiet: true }); }
    }
    updateSyncLabels();
  }, 1000);
  document.addEventListener('visibilitychange', flushDeferredRender);
}

hydrateIcons();
renderAll();
setupInteractions();
setupNavigation();
setupChartTooltip();
window.pulseDesktop?.onNavigate?.((selector) => openTarget(selector));
window.pulseDesktop?.onSyncRequested?.(() => syncUsage());
window.pulseDesktop?.onFullscreenChanged?.((fullscreen) => document.body.classList.toggle('desktop-fullscreen', fullscreen));
window.pulseDesktop?.onSurfaceVisibility?.((visible) => {
  desktopSurfaceVisible = visible;
  flushDeferredRender();
});
updateSyncLabels();
setTimeout(() => document.querySelector('#boot-screen').classList.add('is-done'), 650);
syncUsage({ quiet: true });
startPolling();
