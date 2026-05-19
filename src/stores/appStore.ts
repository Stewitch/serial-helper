import { create } from "zustand";
import type { AppState } from "@/types/flash";

export type AppPage = "monitor" | "flash" | "settings";

interface AppStore {
  appState: AppState;
  previousState: AppState | null;
  activePort: string | null;
  flashModule: string | null;
  activePage: AppPage;

  setState: (state: AppState) => void;
  setActivePort: (port: string | null) => void;
  setFlashModule: (module: string | null) => void;
  setActivePage: (page: AppPage) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  appState: "IDLE",
  previousState: null,
  activePort: null,
  flashModule: null,
  activePage: "monitor",

  setState: (state) =>
    set((prev) => ({
      appState: state,
      previousState: prev.appState,
    })),
  setActivePort: (port) => set({ activePort: port }),
  setFlashModule: (module) => set({ flashModule: module }),
  setActivePage: (page) => set({ activePage: page }),
}));
