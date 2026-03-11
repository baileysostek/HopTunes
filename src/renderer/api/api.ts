/// <reference path="./api.d.ts" />

import { isElectron } from '../utils/platform';

export const toggleFullscreen = () => {
  if (isElectron()) window.electronAPI.toggleFullscreen();
};

export const capturePage = async (): Promise<string | null> => {
  if (!isElectron()) return null;
  try {
    const imageData = await window.electronAPI.capturePage();
    return imageData;
  } catch (error) {
    console.error('Failed to capture page:', error);
    return null;
  }
};

const LOCALSTORAGE_PREFIX = 'opentunes_save_';

export const saveGame = async (saveName: string, saveData: object) => {
  if (isElectron()) {
    await window.electronAPI.saveGame(saveName, saveData);
  } else {
    localStorage.setItem(LOCALSTORAGE_PREFIX + saveName, JSON.stringify(saveData));
  }
};

export const loadGame = async (saveName: string): Promise<object> => {
  if (isElectron()) {
    return await window.electronAPI.loadGame(saveName);
  }
  const data = localStorage.getItem(LOCALSTORAGE_PREFIX + saveName);
  return data ? JSON.parse(data) : {};
};
