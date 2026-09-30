import electronMain from 'electron/main';
import electronCommon from 'electron/common';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } = electronMain;
const { nativeImage } = electronCommon;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.dirname(__dirname);
const isMac = process.platform === 'darwin';
const isDevelopment = !app.isPackaged;
const smokeTest = process.argv.includes('--smoke-test');
const readyFileIndex = process.argv.indexOf('--updater-ready-file');
const updaterReadyFile = readyFileIndex >= 0 ? process.argv[readyFileIndex + 1] : null;
const preferredPort = Number(process.env.PULSE_DESKTOP_PORT) || (isDevelopment ? 5188 : 5187);
const allowedTargets = new Set(['#overview', '#attention', '#limits', '#accounts', '#breakdown', '#activity-log']);

let baseUrl = '';
let mainWindow = null;
let pulseServer = null;
let tray = null;
let trayWindow = null;
let isQuitting = false;
let trayStatus = { lowestRemaining: null, accounts: [], warningCount: 0, paused: false, fetchedAt: null };
let applicationIcon = null;

app.setName('Pulse');
if (isDevelopment || smokeTest) {
  const developmentUserData = smokeTest
    ? path.join(os.tmpdir(), `pulse-smoke-${process.pid}`)
    : path.join(app.getPath('appData'), 'Pulse Development');
  mkdirSync(developmentUserData, { recursive: true });
  app.setPath('userData', developmentUserData);
}
app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function expandCliPath() {
  const userHome = os.homedir();
  const additions = [
    path.join(userHome, '.local', 'bin'),
    path.join(userHome, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ];
  const existing = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  process.env.PATH = [...new Set([...additions, ...existing])].join(path.delimiter);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function startLocalServer() {
  expandCliPath();
  ({ server: pulseServer } = await import('../server.mjs'));
  let selectedPort;
  try {
    selectedPort = await listen(pulseServer, preferredPort);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    selectedPort = await listen(pulseServer, 0);
  }
  baseUrl = `http://127.0.0.1:${selectedPort}`;
  return baseUrl;
}

function iconPath() {
  return path.join(projectDir, 'marketing', 'assets', 'pulse-icon.png');
}

function rendererPreferences({ backgroundThrottling = true } = {}) {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    backgroundThrottling,
    partition: 'persist:pulse'
  };
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(baseUrl)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault();
  });
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    title: 'Pulse',
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    backgroundColor: '#090a0d',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 17, y: 19 } : undefined,
    icon: iconPath(),
    webPreferences: rendererPreferences()
  });
  secureWindow(mainWindow);
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('show', () => sendSurfaceVisibility(mainWindow, true));
  mainWindow.on('hide', () => sendSurfaceVisibility(mainWindow, false));
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('pulse:fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('pulse:fullscreen-changed', false));
  await mainWindow.loadURL(`${baseUrl}/?surface=desktop`);
  mainWindow.webContents.send('pulse:fullscreen-changed', mainWindow.isFullScreen());
  if (!smokeTest) {
    mainWindow.show();
    mainWindow.focus();
    if (isMac) app.focus({ steal: true });
  }
  return mainWindow;
}

// `backgroundThrottling: false` pins document.visibilityState to 'visible', so
// the renderer cannot tell on its own that the popover is off screen. The main
// process is the only place that knows, and it says so explicitly.
function sendSurfaceVisibility(window, visible) {
  if (window && !window.isDestroyed()) window.webContents.send('pulse:surface-visibility', visible);
}

function normalizedTarget(target) {
  return typeof target === 'string' && allowedTargets.has(target) ? target : '#overview';
}

async function showMainWindow(target = '#overview') {
  const window = await createMainWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (isMac) app.focus({ steal: true });
  window.webContents.send('pulse:navigate', normalizedTarget(target));
  if (trayWindow?.isVisible()) trayWindow.hide();
}

async function createTrayWindow() {
  trayWindow = new BrowserWindow({
    title: 'Pulse menu bar',
    width: 420,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: rendererPreferences({ backgroundThrottling: false })
  });
  secureWindow(trayWindow);
  trayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trayWindow.on('blur', () => {
    if (!trayWindow.webContents.isDevToolsOpened()) trayWindow.hide();
  });
  trayWindow.on('closed', () => { trayWindow = null; });
  trayWindow.on('show', () => sendSurfaceVisibility(trayWindow, true));
  trayWindow.on('hide', () => sendSurfaceVisibility(trayWindow, false));
  await trayWindow.loadURL(`${baseUrl}/?surface=tray`);
  sendSurfaceVisibility(trayWindow, trayWindow.isVisible());
  return trayWindow;
}

function positionTrayWindow(bounds) {
  if (!trayWindow) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) });
  const { workArea } = display;
  const [windowWidth, windowHeight] = trayWindow.getSize();
  const centeredX = Math.round(bounds.x + bounds.width / 2 - windowWidth / 2);
  const x = Math.max(workArea.x + 8, Math.min(centeredX, workArea.x + workArea.width - windowWidth - 8));
  const below = Math.round(bounds.y + bounds.height + 6);
  const y = below + windowHeight <= workArea.y + workArea.height
    ? below
    : Math.round(bounds.y - windowHeight - 6);
  trayWindow.setPosition(x, y, false);
}

function toggleTrayWindow(bounds = tray?.getBounds()) {
  if (!trayWindow || !bounds) return;
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  positionTrayWindow(bounds);
  trayWindow.show();
  trayWindow.focus();
}

function safePercent(value, fallback = null) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function displayPercent(value) {
  const percent = safePercent(value);
  if (percent === null) return null;
  return percent <= 0 ? 0 : Math.max(1, Math.round(percent));
}

function trayWindowPercent(window) {
  return displayPercent(safePercent(window?.displayRemaining, window?.remaining));
}

function trayWindowLabel(window) {
  const percent = trayWindowPercent(window);
  return percent === null ? '—' : `${percent}%`;
}

function trayAccountTag(account, index) {
  return account.identityTag || `C${index + 1}`;
}

let trayPresentation = { title: null, tooltip: null };

function updateTrayPresentation() {
  if (!tray) return;
  const remaining = Number.isFinite(trayStatus.lowestRemaining) ? `${displayPercent(trayStatus.lowestRemaining)}%` : '—';
  const health = trayStatus.paused ? 'sync paused' : 'sync healthy';
  const warnings = trayStatus.warningCount === 1 ? '1 warning' : `${trayStatus.warningCount} warnings`;
  const accountTitle = trayStatus.accounts.map((account, index) => {
    const values = account.windows.map((window) => trayWindowLabel(window)).join('/');
    return `${trayAccountTag(account, index)} ${values || '—'}`;
  }).join(' · ');
  const accountTooltip = trayStatus.accounts.map((account, index) => {
    const windows = account.windows.map((window) => `${window.tag} ${trayWindowLabel(window)}`).join(', ');
    return `${trayAccountTag(account, index)} ${account.profile}: ${windows || 'not reported'}`;
  }).join(' · ');
  const tooltip = `Pulse · ${accountTooltip || `${remaining} lowest headroom`} · ${warnings} · ${health}`;
  // A status payload arrives on every renderer poll, but the menu-bar text only
  // changes when a percentage actually moves. Skipping no-op AppKit writes keeps
  // the item from redrawing several times a minute for nothing.
  if (tooltip !== trayPresentation.tooltip) {
    tray.setToolTip(tooltip);
    trayPresentation.tooltip = tooltip;
  }
  if (isMac && accountTitle !== trayPresentation.title) {
    tray.setTitle(accountTitle, { fontType: 'monospacedDigit' });
    trayPresentation.title = accountTitle;
  }
}

function trayMenu() {
  const remaining = Number.isFinite(trayStatus.lowestRemaining) ? `${displayPercent(trayStatus.lowestRemaining)}% lowest headroom` : 'Waiting for usage snapshot';
  const accountItems = trayStatus.accounts.map((account, index) => ({
    label: `${trayAccountTag(account, index)} ${account.profile} · ${account.windows.map((window) => `${window.tag} ${trayWindowLabel(window)}`).join(' · ') || 'not reported'}`,
    enabled: false
  }));
  return Menu.buildFromTemplate([
    ...(accountItems.length ? accountItems : [{ label: remaining, enabled: false }]),
    { label: trayStatus.paused ? 'Sync paused' : 'Sync healthy', enabled: false },
    { type: 'separator' },
    { label: 'Open Pulse', click: () => void showMainWindow('#overview') },
    { label: 'Sync now', click: () => {
      mainWindow?.webContents.send('pulse:sync');
      trayWindow?.webContents.send('pulse:sync');
    } },
    ...(isMac ? [{
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    }] : []),
    { type: 'separator' },
    { label: 'Quit Pulse', role: 'quit' }
  ]);
}

function createTray() {
  const source = applicationIcon || nativeImage.createFromPath(iconPath());
  const image = source.resize({ width: isMac ? 19 : 20, height: isMac ? 19 : 20, quality: 'best' });
  tray = new Tray(image);
  tray.setToolTip('Pulse · loading local usage');
  tray.on('click', (_event, bounds) => toggleTrayWindow(bounds));
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  updateTrayPresentation();
}

function registerIpc() {
  const fromPulse = (event) => String(event.senderFrame?.url || '').startsWith(baseUrl);
  ipcMain.on('pulse:open-main', (event, target) => {
    if (fromPulse(event)) void showMainWindow(normalizedTarget(target));
  });
  ipcMain.on('pulse:hide-tray', (event) => {
    if (fromPulse(event)) trayWindow?.hide();
  });
  ipcMain.on('pulse:tray-status', (event, payload) => {
    if (!fromPulse(event) || !payload || typeof payload !== 'object') return;
    const lowestRemaining = safePercent(payload.lowestRemaining);
    const accounts = Array.isArray(payload.accounts) ? payload.accounts.slice(0, 8).map((account, index) => ({
      id: String(account?.id || `codex-account-${index + 1}`).slice(0, 80),
      providerId: String(account?.providerId || 'codex').slice(0, 40),
      identityTag: String(account?.identityTag || `C${index + 1}`).slice(0, 12),
      profile: String(account?.profile || `Codex ${index + 1}`).slice(0, 80),
      plan: String(account?.plan || 'Unknown').slice(0, 40),
      windows: Array.isArray(account?.windows) ? account.windows.slice(0, 4).map((window) => ({
        tag: String(window?.tag || 'LIVE').slice(0, 12),
        label: String(window?.label || 'Current window').slice(0, 80),
        remaining: safePercent(window?.remaining),
        displayRemaining: safePercent(window?.displayRemaining, displayPercent(window?.remaining)),
        reset: String(window?.reset || 'reset time unavailable').slice(0, 100)
      })) : []
    })) : [];
    trayStatus = {
      lowestRemaining: Number.isFinite(lowestRemaining) ? Math.max(0, Math.min(100, lowestRemaining)) : null,
      accounts,
      warningCount: Math.max(0, Math.min(99, Number(payload.warningCount) || 0)),
      paused: Boolean(payload.paused),
      fetchedAt: Number(payload.fetchedAt) || null
    };
    updateTrayPresentation();
  });
}

function createApplicationMenu() {
  const template = [
    ...(isMac ? [{
      label: 'Pulse',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Open Pulse', accelerator: 'CmdOrCtrl+O', click: () => void showMainWindow('#overview') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  applicationIcon = nativeImage.createFromPath(iconPath());
  if (applicationIcon.isEmpty()) throw new Error(`Pulse icon could not be loaded from ${iconPath()}`);
  if (isMac) {
    app.setActivationPolicy('regular');
    await app.dock?.show();
    // Installed apps use the native bundle icon, including macOS appearance
    // variants. A runtime PNG override bypasses that rendering.
    if (isDevelopment) app.dock?.setIcon(applicationIcon);
  }
  app.setAboutPanelOptions({
    applicationName: 'Pulse',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Oliver Perrin',
    website: 'https://github.com/OliverPerrin/pulse'
  });
  await startLocalServer();
  registerIpc();
  createApplicationMenu();
  await Promise.all([createMainWindow(), createTrayWindow()]);
  createTray();

  if (updaterReadyFile && !smokeTest) {
    // The updater waits for this acknowledgement from the real user profile,
    // not just a running process or a listening port.
    const response = await fetch(`${baseUrl}/api/usage?days=30`);
    if (!response.ok) throw new Error(`Updater startup check: HTTP ${response.status}`);
    await mainWindow.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 60000;
      while (document.querySelector('#connection-title')?.textContent !== 'Your local usage, connected') {
        if (Date.now() > deadline) throw new Error('Dashboard did not load a live snapshot');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    })()`);
    const metadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    const temporary = `${updaterReadyFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, version: app.getVersion(), commit: metadata.pulseBuildCommit, baseUrl }), { mode: 0o600 });
    renameSync(temporary, updaterReadyFile);
  }

  if (smokeTest) {
    const apiResponse = await fetch(`${baseUrl}/api/usage?days=30`);
    if (!apiResponse.ok) throw new Error(`Usage API returned HTTP ${apiResponse.status}`);
    const apiSnapshot = await apiResponse.json();
    const imageChecks = await Promise.all([mainWindow, trayWindow].map((window) => window.webContents.executeJavaScript(`
      Promise.all([...document.images].map(image => image.decode().then(() => image.naturalWidth > 0, () => false)))
        .then(results => results.length > 0 && results.every(Boolean))
    `)));
    // Loading begins with empty, unreported data. Wait for the first real
    // snapshot, then render the hidden surfaces as if the user opened them.
    for (const window of [mainWindow, trayWindow]) sendSurfaceVisibility(window, true);
    await Promise.all([mainWindow, trayWindow].map((window) => window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 60000;
        while (document.querySelector('#sync-button')?.classList.contains('is-syncing') && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })()
    `)));
    await mainWindow.webContents.executeJavaScript(`document.querySelector('.brand').style.transition = 'none'`);
    mainWindow.webContents.send('pulse:fullscreen-changed', true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const fullscreenLogoProbe = await mainWindow.webContents.executeJavaScript(`({
      fullscreenClass: document.body.classList.contains('desktop-fullscreen'),
      transform: getComputedStyle(document.querySelector('.brand')).transform
    })`);
    mainWindow.webContents.send('pulse:fullscreen-changed', false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const windowedLogoProbe = await mainWindow.webContents.executeJavaScript(`({
      fullscreenClass: document.body.classList.contains('desktop-fullscreen'),
      transform: getComputedStyle(document.querySelector('.brand')).transform
    })`);
    const [mainProbe, trayProbe] = await Promise.all([
      mainWindow.webContents.executeJavaScript(`({
        bridgeReady: Boolean(window.pulseDesktop),
        nodeIsolated: typeof window.require === 'undefined' && typeof window.process === 'undefined',
        desktopSurface: document.body.classList.contains('desktop-app-surface'),
        snapshotLoaded: document.querySelector('#connection-title')?.textContent === 'Your local usage, connected',
        logoOffsetReady: getComputedStyle(document.querySelector('.brand')).transform !== 'none'
      })`),
      trayWindow.webContents.executeJavaScript(`({
        bridgeReady: Boolean(window.pulseDesktop),
        compactMode: document.body.classList.contains('compact-mode'),
        snapshotLoaded: document.querySelector('#connection-title')?.textContent === 'Your local usage, connected',
        resetTimesVisible: /reset/i.test(document.querySelector('#compact-headroom')?.innerText || ''),
        accountLimitCount: document.querySelectorAll('#compact-headroom .compact-account-limit').length,
        remainingMeterCount: document.querySelectorAll('#compact-headroom .compact-window-meter').length,
        fitsWindow: document.documentElement.scrollHeight <= document.documentElement.clientHeight
      })`)
    ]);
    const expectedWindowCount = trayStatus.accounts.reduce((sum, account) => sum + account.windows.length, 0);
    const result = {
      baseUrl,
      apiSnapshotValid: Number.isFinite(apiSnapshot.fetchedAt)
        && !/preview|loading/i.test(apiSnapshot.mode || '')
        && Array.isArray(apiSnapshot.providers) && Array.isArray(apiSnapshot.codexAccounts),
      dashboardImagesLoaded: imageChecks.every(Boolean),
      mainLoaded: mainWindow?.webContents.getURL().includes('surface=desktop') || false,
      trayLoaded: trayWindow?.webContents.getURL().includes('surface=tray') || false,
      iconLoaded: !nativeImage.createFromPath(iconPath()).isEmpty(),
      dockIconVisible: !isMac || Boolean(app.dock?.isVisible()),
      rendererSandboxed: mainProbe.nodeIsolated && trayProbe.bridgeReady,
      liveSnapshotReady: mainProbe.snapshotLoaded && trayProbe.snapshotLoaded,
      mainBridgeReady: mainProbe.bridgeReady && mainProbe.desktopSurface && mainProbe.logoOffsetReady,
      fullscreenLogoResponsive: fullscreenLogoProbe.fullscreenClass
        && fullscreenLogoProbe.transform === 'matrix(1, 0, 0, 1, 0, 0)'
        && !windowedLogoProbe.fullscreenClass
        && windowedLogoProbe.transform !== fullscreenLogoProbe.transform,
      trayCompactReady: trayProbe.compactMode
        && (expectedWindowCount === 0 || trayProbe.resetTimesVisible)
        && trayProbe.accountLimitCount === trayStatus.accounts.length
        && trayProbe.remainingMeterCount === expectedWindowCount
        && trayProbe.fitsWindow,
      trayStatusReported: Number.isFinite(trayStatus.fetchedAt) && trayStatus.accounts.length > 0
        && (trayStatus.lowestRemaining === null || Number.isFinite(trayStatus.lowestRemaining)),
      menuBarAllAccountsReady: !isMac || (trayStatus.accounts.length > 0
        && trayStatus.accounts.every((account, index) => tray.getTitle().includes(`${trayAccountTag(account, index)} `)))
    };
    console.log(`PULSE_SMOKE ${JSON.stringify(result)}`);
    isQuitting = true;
    const failed = Object.entries(result).filter(([key, value]) => key !== 'baseUrl' && value !== true);
    if (failed.length) throw new Error(`Smoke checks failed: ${failed.map(([key]) => key).join(', ')}`);
    clearTimeout(smokeTimeout);
    setTimeout(() => app.quit(), 120);
  }
}

app.on('second-instance', () => { void showMainWindow('#overview'); });
app.on('activate', () => { void showMainWindow('#overview'); });
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  if (pulseServer?.listening) pulseServer.close();
});
app.on('window-all-closed', () => {
  // Pulse remains available in the menu bar until the user explicitly quits.
});

const smokeTimeout = smokeTest ? setTimeout(() => {
  console.error('Pulse smoke test timed out');
  app.exit(1);
}, 90000) : null;

app.whenReady().then(bootstrap).catch((error) => {
  console.error('Pulse failed to start', error);
  isQuitting = true;
  clearTimeout(smokeTimeout);
  app.exit(1);
});
