import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';

const isMac = process.platform === 'darwin';

export const createMenu = (mainWindow: BrowserWindow) => {
  const template: MenuItemConstructorOptions[] = [
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Save Game',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            // In a real application, you would send an IPC message to the renderer process
            // to trigger a save action.
            mainWindow.webContents.send('save-game');
          },
        },
        { type: 'separator' },
        { role: 'quit' }, // This uses a predefined role
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            // You can open a new window or a modal dialog here
            console.log('About menu item clicked');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};