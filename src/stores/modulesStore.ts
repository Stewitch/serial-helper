import { create } from "zustand";

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  installed: boolean;
  chip_count: number;
  format_count: number;
  status: string;
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
  setModulesData: (modules: ModuleInfo[], envByModule: Record<string, EnvStatus>) => void;
  updateModuleEnv: (module: ModuleInfo, env: EnvStatus) => void;
  setRefreshing: (refreshing: boolean) => void;
}

export const useModulesStore = create<ModulesStore>((set) => ({
  modules: [],
  envByModule: {},
  lastLoadedAt: null,
  refreshing: false,
  setModulesData: (modules, envByModule) =>
    set({
      modules,
      envByModule,
      lastLoadedAt: Date.now(),
    }),
  updateModuleEnv: (module, env) =>
    set((prev) => {
      const nextModules = prev.modules.some((item) => item.id === module.id)
        ? prev.modules.map((item) => (item.id === module.id ? module : item))
        : [...prev.modules, module];
      return {
        modules: nextModules,
        envByModule: {
          ...prev.envByModule,
          [module.id]: env,
        },
        lastLoadedAt: Date.now(),
      };
    }),
  setRefreshing: (refreshing) => set({ refreshing }),
}));
