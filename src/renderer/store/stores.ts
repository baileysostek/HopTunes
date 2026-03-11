import { loadGame, saveGame } from "../api/api";
import { useCardStore } from "./cards";
import { useUnlockedSpeciesStore } from "./unlockedSpecies";

interface GameSaveData {
  unlockedSpecies?: object;
  cards?: object;
}

export const saveAllStores = () => {
    const unlockedSpeciesState = useUnlockedSpeciesStore.getState().saveState();
    const cardState = useCardStore.getState().saveState();

    const saveData = {
        unlockedSpecies: unlockedSpeciesState,
        cards: cardState
    };
    saveGame("autosave", saveData);
    console.log("Saved");
};

export const loadAllStores = async () => {
    const loadedData: GameSaveData = await loadGame("autosave");
    if (loadedData && loadedData.unlockedSpecies) {
        useUnlockedSpeciesStore.getState().loadState(loadedData.unlockedSpecies);
    }
    if (loadedData && loadedData.cards) {
        useCardStore.getState().loadState(loadedData.cards);
    }
};
