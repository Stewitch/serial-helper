import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/** Mirrors `ModuleChip` in src-tauri/src/flash/module_trait.rs. */
export interface ModuleChip {
  id: string;
  name: string;
  flash_kb: number;
  ram_kb: number;
  flash_start: number;
  page_size: number;
}

/** Mirrors `ModuleDescriptor` in src-tauri/src/flash/module_trait.rs. */
export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  availability: "available" | "planned";
  chip_selection: "detect" | "manual" | "manual-confirmed";
  chips: ModuleChip[];
  formats: string[];
  required_tools: string[];
}

export interface EnvStatus {
  ready: boolean;
  missing_tools: string[];
  messages: string[];
  version?: string | null;
  install_hint?: string | null;
  install_steps: string[];
  references: { label: string; url: string }[];
}

interface ModulesStore {
  modules: ModuleInfo[];
  envByModule: Record<string, EnvStatus>;
  lastLoadedAt: number | null;
  refreshing: boolean;
  /** Loads the module list once; later calls reuse it. */
  ensureModules: () => Promise<ModuleInfo[]>;
  setModulesData: (modules: ModuleInfo[], envByModule: Record<string, EnvStatus>) => void;
  updateModuleEnv: (module: ModuleInfo, env: EnvStatus) => void;
  setEnv: (id: string, env: EnvStatus) => void;
  setRefreshing: (refreshing: boolean) => void;
}

let loading: Promise<ModuleInfo[]> | null = null;

export const useModulesStore = create<ModulesStore>((set, get) => ({
  modules: [],
  envByModule: {},
  lastLoadedAt: null,
  refreshing: false,
  ensureModules: () => {
    if (get().modules.length > 0) return Promise.resolve(get().modules);
    loading ??= invoke<ModuleInfo[]>("list_modules")
      .then((modules) => {
        set({ modules });
        return modules;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  },
  setModulesData: (modules, envByModule) => set({ modules, envByModule, lastLoadedAt: Date.now() }),
  updateModuleEnv: (module, env) =>
    set((prev) => ({
      modules: prev.modules.some((m) => m.id === module.id)
        ? prev.modules.map((m) => (m.id === module.id ? module : m))
        : [...prev.modules, module],
      envByModule: { ...prev.envByModule, [module.id]: env },
      lastLoadedAt: Date.now(),
    })),
  setEnv: (id, env) => set((prev) => ({ envByModule: { ...prev.envByModule, [id]: env } })),
  setRefreshing: (refreshing) => set({ refreshing }),
}));
