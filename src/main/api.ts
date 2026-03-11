import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import fs from "fs";

/**
 * Sets up all IPC handlers for the main process.
 * This function encapsulates all communication logic from the renderer.
 * @param {BrowserWindow} window The main window instance to act upon.
 */
export const setupIpcHandlers = (window: BrowserWindow): void => {
  // IPC listener for a 'toggle-fullscreen' command from the renderer.
  ipcMain.on('toggle-fullscreen', () => {
    if (window) {
      window.setFullScreen(!window.isFullScreen());
    }
  });

  // This handler is for the capture-page request from the renderer.
  // It uses ipcMain.handle to support an asynchronous request-response.
  // The renderer will use 'invoke' to call this handler and await the return value.
  ipcMain.handle('capture-page', async () => {
    try {
      if (window) {
        // Capture the page and return the image data as a base64 string.
        const image = await window.webContents.capturePage();
        return image.toPNG().toString('base64');
      }
      return null;
    } catch (error) {
      console.error('Failed to capture page:', error);
      return null;
    }
  });

  // Window control handlers for custom titlebar
  ipcMain.on('window-minimize', () => window?.minimize());
  ipcMain.on('window-maximize', () => {
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });
  ipcMain.on('window-close', () => window?.close());
  ipcMain.handle('window-is-maximized', () => window?.isMaximized() ?? false);

  ipcMain.handle('save-game', async (event : IpcMainEvent, saveName : string, saveData : object) => {
    fs.writeFileSync(`./${saveName}.json`, JSON.stringify(saveData, null, 2))
  });

  ipcMain.handle('load-game', async (event : IpcMainEvent, saveName : string) => {
    const path = `./${saveName}.json`;
    if (fs.existsSync(path)) {
      const fileContent : string = fs.readFileSync(path, 'utf8');
      return JSON.parse(fileContent);
    } else {
      return {};
    }
  });
};