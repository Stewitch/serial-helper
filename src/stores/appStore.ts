import { create } from "zustand";
import type { AppState } from "@/types/flash";

interface AppStore {
  appState: AppState;
  previousState: AppState | null;
  activePort: string | null;
  flashModule: string | null;

  setState: (state: AppState) => void;
  setActivePort: (port: string | null) => void;
  setFlashModule: (module: string | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  appState: "IDLE",
  previousState: null,
  activePort: null,
  flashModule: null,

  setState: (state) =>
    set((prev) => ({
      appState: state,
      previousState: prev.appState,
    })),
  setActivePort: (port) => set({ activePort: port }),
  setFlashModule: (module) => set({ flashModule: module }),
}));
