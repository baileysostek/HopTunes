// store.ts
import { create } from 'zustand';
import { Shrimp } from '../game/Shrimp';
import { ShrimpSpecies } from '../game/Species';
import { SaveableStore } from './saveableStore';

// CardData wraps Shrimp with UI info
export interface CardData {
  visible: boolean;
  x: number;
  y: number;
  shrimp: Shrimp;
}

// State now holds CardData
interface CardState {
  cards: Map<string, CardData>;
}

// Actions work with CardData
interface CardActions extends SaveableStore {
  addCard: (shrimp: Shrimp, visible ?: boolean, x ?: number, y ?: number) => void;
  removeCard: (idToRemove: string, keepInWorld ?: boolean) => void;
  updateCard: (idToUpdate: string, newData: Partial<CardData>) => void;
  setVisible: (id : string, visible : boolean) => void;
  moveToInventory: (cardID: string) => void;
  moveToWorld: (cardID: string, x ?: number, y ?: number) => void;
}

type CardStore = CardState & CardActions;

export const useCardStore = create<CardStore>((set, get) => ({
  cards: new Map<string, CardData>([
    [
      'a',
      {
        visible: true,
        x: 100,
        y: 100,
        shrimp: { id: 'a', species: ShrimpSpecies.Wild, generation: 1 },
      },
    ],
    [
      'b',
      {
        visible: true,
        x: 200,
        y: 100,
        shrimp: { id: 'b', species: ShrimpSpecies.Wild, generation: 1 },
      },
    ],
    [
      'c',
      {
        visible: true,
        x: 300,
        y: 100,
        shrimp: { id: 'c', species: ShrimpSpecies.Wild, generation: 1 },
      },
    ],
  ]),

  addCard: (shrimp, visible : boolean = true, x : number = 0, y : number = 0) =>
    set((state) => {
      const newCards = new Map(state.cards);
      newCards.set(shrimp.id, {
        visible,
        x,
        y,
        shrimp,
      });
      return { cards: newCards };
    }),

  removeCard: (idToRemove) => {
    set((state) => {
      const newCards = new Map(state.cards);
      newCards.delete(idToRemove);
      return { cards: newCards };
    });
  },

  moveToInventory: (cardID) => {
    set((state) => {
      const newCards = new Map(state.cards);
      
      // Update the visible property
      const card = newCards.get(cardID);
      if (card) {
        newCards.set(cardID, { ...card, visible: false });
      }
      
      // Return the new state in a single transaction
      return { cards: newCards };
    });
  },

  moveToWorld: (cardID, x = 0, y = 0) => {
    set((state) => {
      const newCards = new Map(state.cards);
      const card = newCards.get(cardID);
      if (card) {
        newCards.set(cardID, {
          ...card,
          visible: true,
          x,
          y,
        });
      }
      return { cards: newCards };
    });
  },

  updateCard: (idToUpdate, newData) => {
    set((state) => {
      const card = state.cards.get(idToUpdate);
      if (card) {
        const newCards = new Map(state.cards);
        newCards.set(idToUpdate, { ...card, ...newData });
        return { cards: newCards };
      }
      return state;
    });
  },

  setVisible: (id : string, visible : boolean) => {
    set((state) => {
      const card = state.cards.get(id);
      if (card) {
        const newCards = new Map(state.cards);
        newCards.set(id, { ...card, visible: visible });
        return { cards: newCards };
      }
      return state;
    });
  },

  saveState: () => {
    return Array.from(get().cards.entries());
  },

  loadState: (state: object) => {
    try {
      const parsedArray: [string, CardData][] = state as any;
      const newCards = new Map(parsedArray);
      set({ cards: newCards });
    } catch (error) {
      console.error('Failed to load state from JSON:', error);
    }
  },
}));
