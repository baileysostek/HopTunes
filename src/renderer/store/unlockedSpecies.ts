import { create } from 'zustand';
import { ShrimpSpecies } from '../game/Species';
import { SaveableStore } from './saveableStore';

interface UnlockedSpeciesState extends SaveableStore {
  unlockedSpecies: Record<ShrimpSpecies, boolean>;
  unlockSpecies: (species: ShrimpSpecies) => void;
  isUnlocked: (species: ShrimpSpecies) => boolean;
}

const initialUnlockedState: Record<ShrimpSpecies, boolean> = Object.values(ShrimpSpecies).reduce((acc, species) => {
  acc[species] = false;
  return acc;
}, {} as Record<ShrimpSpecies, boolean>);

export const useUnlockedSpeciesStore = create<UnlockedSpeciesState>((set, get) => ({
  unlockedSpecies: initialUnlockedState,

  // Action to unlock a species
  unlockSpecies: (species) => {
    // Get the current state of unlocked species
    const isCurrentlyUnlocked = get().unlockedSpecies[species];

    // Update the state to unlock the species
    set((state) => ({
      unlockedSpecies: {
        ...state.unlockedSpecies,
        [species]: true,
      },
    }));

    if (!isCurrentlyUnlocked) {
      console.log(`Congratulations! You've unlocked a new species: ${species}`);
    }
  },

  // Selector to check if a species is unlocked
  isUnlocked: (species) => {
    return get().unlockedSpecies[species] || false;
  },

  saveState: () => {
    return get().unlockedSpecies;
  },

  loadState: (state : object) => {
    try {
      const parsedState: Record<ShrimpSpecies, boolean> = state as any;
      set({ unlockedSpecies: parsedState });
    } catch (error) {
      console.error("Failed to load state from JSON:", error);
    }
  },
}));