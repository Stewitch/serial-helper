import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  can_install: boolean;
  source: "system" | "managed" | null;
  missing_tools: string[];
  messages: string[];
  version?: string | null;
  install_hint?: string | null;
  install_steps: string[];
  references: { label: string; url: string }[];
}

interface Installation {
  running: boolean;
  log: string[];
  error?: string;
}

interface ModulesStore {
  modules: ModuleInfo[];
  envByModule: Record<string, EnvStatus>;
  scanned: boolean;
  refreshing: boolean;
  scanError: string | null;
  installByModule: Record<string, Installation>;
  setupModuleId: string | null;
  /** Loads the module list once; later calls reuse it. */
  ensureModules: () => Promise<ModuleInfo[]>;
  checkEnvironment: (id: string) => Promise<EnvStatus>;
  refreshModules: () => Promise<void>;
  installTools: (id: string) => Promise<void>;
  setSetupModuleId: (id: string | null) => void;
}

let loading: Promise<ModuleInfo[]> | null = null;
const checking = new Map<string, Promise<EnvStatus>>();

export const useModulesStore = create<ModulesStore>((set, get) => ({
  modules: [],
  envByModule: {},
  scanned: false,
  refreshing: false,
  scanError: null,
  installByModule: {},
  setupModuleId: null,
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
  checkEnvironment: (id) => {
    const pending = checking.get(id);
    if (pending) return pending;
    const installation = get().installByModule[id];
    const request = invoke<EnvStatus>("check_module_env", { moduleId: id })
      .then((env) => {
        const current = get();
        if (!installation?.running && current.installByModule[id] === installation) {
          set({ envByModule: { ...current.envByModule, [id]: env } });
        }
        return env;
      })
      .finally(() => checking.delete(id));
    checking.set(id, request);
    return request;
  },
  refreshModules: async () => {
    if (get().refreshing) return;
    set({ refreshing: true, scanError: null });
    try {
      const modules = await get().ensureModules();
      const results = await Promise.allSettled(modules.map((module) => get().checkEnvironment(module.id)));
      const failed = results.find((result) => result.status === "rejected");
      set({ scanned: true, scanError: failed ? String(failed.reason) : null });
    } catch (error) {
      set({ scanError: String(error) });
    } finally {
      set({ refreshing: false });
    }
  },
  installTools: async (id) => {
    if (get().installByModule[id]?.running) return;
    const update = (installation: Installation) =>
      set((state) => ({ installByModule: { ...state.installByModule, [id]: installation } }));
    update({ running: true, log: [] });
    let unlisten: UnlistenFn | undefined;
    let error: string | undefined;
    try {
      unlisten = await listen<{ module: string; line: string }>("module-install-output", ({ payload }) => {
        if (payload.module !== id) return;
        const current = get().installByModule[id];
        update({ ...current, log: [...current.log.slice(-299), payload.line] });
      });
      const env = await invoke<EnvStatus>("install_module_tools", { moduleId: id });
      set((state) => ({ envByModule: { ...state.envByModule, [id]: env } }));
    } catch (cause) {
      error = String(cause);
    } finally {
      unlisten?.();
      update({ ...get().installByModule[id], running: false, error });
    }
  },
  setSetupModuleId: (id) => set({ setupModuleId: id }),
}));
