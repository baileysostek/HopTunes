// This file is a type definition for the Electron API exposed via the preload script.

// This empty export statement makes this file a module, allowing global scope augmentation.
export {};

// This declaration merges with the existing global Window interface.
declare global {
  interface Window {
    electronAPI: {
      toggleFullscreen: () => void;
      capturePage: () => Promise<string | null>;
      saveGame: (saveName: string, saveData: object) => Promise<void>;
      loadGame: (saveName: string) => Promise<object>;
      showItemInFolder: (filePath: string) => void;
      selectFolder: () => Promise<string | null>;
      selectImage: () => Promise<string | null>;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      windowIsMaximized: () => Promise<boolean>;
      getPathForFile: (file: File) => string;
    };
  }
}
