import { create } from 'zustand';

// Define the state and actions for the dragging store
interface DraggingState {
  isDraggingCard: boolean;
  setDraggingCard: (isDragging: boolean) => void;
}

// Create the Zustand store
export const useInteractionStore = create<DraggingState>((set) => ({
  isDraggingCard: false,
  setDraggingCard: (isDragging) => set({ isDraggingCard: isDragging }),
}));