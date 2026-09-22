const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseDesktop', Object.freeze({
  platform: process.platform,
  openMainWindow: (target = '#overview') => ipcRenderer.send('pulse:open-main', target),
  hideTray: () => ipcRenderer.send('pulse:hide-tray'),
  reportTrayStatus: (status) => ipcRenderer.send('pulse:tray-status', status),
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, target) => callback(target);
    ipcRenderer.on('pulse:navigate', listener);
    return () => ipcRenderer.removeListener('pulse:navigate', listener);
  },
  onSyncRequested: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('pulse:sync', listener);
    return () => ipcRenderer.removeListener('pulse:sync', listener);
  },
  onSurfaceVisibility: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, visible) => callback(Boolean(visible));
    ipcRenderer.on('pulse:surface-visibility', listener);
    return () => ipcRenderer.removeListener('pulse:surface-visibility', listener);
  },
  onFullscreenChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, fullscreen) => callback(Boolean(fullscreen));
    ipcRenderer.on('pulse:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('pulse:fullscreen-changed', listener);
  }
}));
