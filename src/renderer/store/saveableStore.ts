interface SaveableStore {
  saveState: () => object;
  loadState: (state: object) => void;
}

export type { SaveableStore };