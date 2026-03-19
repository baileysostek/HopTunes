// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Expose a limited subset of IPC functionality to the renderer process.
// This is a crucial security step to prevent the renderer from accessing
// all of Electron's powerful, but potentially dangerous, APIs.
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  capturePage: () => ipcRenderer.invoke('capture-page'),
  saveGame: (saveName : string, saveData : object) => ipcRenderer.invoke('save-game', saveName, saveData),
  loadGame: (saveName : string) => ipcRenderer.invoke('load-game', saveName),

  // Show a file in the system file manager
  showItemInFolder: (filePath: string) => ipcRenderer.send('show-item-in-folder', filePath),

  // Open a folder picker dialog
  selectFolder: () => ipcRenderer.invoke('select-folder') as Promise<string | null>,

  // Open an image file picker dialog (returns base64 image data or null)
  selectImage: () => ipcRenderer.invoke('select-image') as Promise<string | null>,

  // Window controls for custom titlebar
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Get the native file path for a dropped File object
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});