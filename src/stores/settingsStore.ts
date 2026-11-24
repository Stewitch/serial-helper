import { create } from "zustand";
import { normalizeEncoding } from "@/lib/textCodec";
import { migrateKey } from "@/lib/storage";

type ThemePreset = "system" | "light" | "dark";
type LineEnding = "CRLF" | "LF" | "CR" | "NONE";

interface SettingsStore {
  theme: ThemePreset;
  language: string;
  fontSize: number;
  uiScale: number;
  timestampEnabled: boolean;
  timestampFormat: string;
  autoScroll: boolean;
  lineEnding: LineEnding;
  encoding: string;
  autoReconnect: boolean;
  autoResumeMonitor: boolean;
  autoNavigateMonitorAfterFlash: boolean;
  monitorMaxLines: number;
  sidebarExpanded: boolean;
  showSplash: boolean;

  setTheme: (theme: ThemePreset) => void;
  setLanguage: (lang: string) => void;
  setFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  setTimestampEnabled: (enabled: boolean) => void;
  setTimestampFormat: (format: string) => void;
  setAutoScroll: (scroll: boolean) => void;
  setLineEnding: (le: LineEnding) => void;
  setEncoding: (enc: string) => void;
  setAutoReconnect: (reconnect: boolean) => void;
  setAutoResumeMonitor: (resume: boolean) => void;
  setAutoNavigateMonitorAfterFlash: (navigate: boolean) => void;
  toggleSidebar: () => void;
  setShowSplash: (show: boolean) => void;
  applyTheme: () => void;
  applyUiScale: () => void;
  persist: () => void;
}

function loadSettings(): Partial<SettingsStore> {
  try {
    const raw = localStorage.getItem("serial-helper-settings") ?? migrateKey("serialhelper-settings", "serial-helper-settings");
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function getSystemTheme(): "light" | "dark" {
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

const saved = loadSettings();

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: (saved.theme as ThemePreset) || "system",
  language: saved.language || "zh-CN",
  fontSize: saved.fontSize || 13,
  uiScale: saved.uiScale || 14,
  timestampEnabled: saved.timestampEnabled ?? true,
  timestampFormat: saved.timestampFormat || "HH:mm:ss.SSS",
  autoScroll: saved.autoScroll ?? true,
  lineEnding: (saved.lineEnding as LineEnding) || "CRLF",
  encoding: normalizeEncoding(saved.encoding),
  autoReconnect: saved.autoReconnect ?? true,
  autoResumeMonitor: saved.autoResumeMonitor ?? true,
  autoNavigateMonitorAfterFlash: saved.autoNavigateMonitorAfterFlash ?? true,
  monitorMaxLines: saved.monitorMaxLines || 50000,
  sidebarExpanded: saved.sidebarExpanded ?? false,
  showSplash: saved.showSplash ?? true,

  setTheme: (theme) => {
    set({ theme });
    get().applyTheme();
    get().persist();
  },
  setLanguage: (language) => {
    set({ language });
    get().persist();
  },
  setFontSize: (fontSize) => {
    set({ fontSize });
    get().persist();
  },
  setUiScale: (uiScale) => {
    set({ uiScale });
    get().applyUiScale();
    get().persist();
  },
  setTimestampEnabled: (timestampEnabled) => {
    set({ timestampEnabled });
    get().persist();
  },
  setTimestampFormat: (timestampFormat) => {
    set({ timestampFormat });
    get().persist();
  },
  setAutoScroll: (autoScroll) => {
    set({ autoScroll });
    get().persist();
  },
  setLineEnding: (lineEnding) => {
    set({ lineEnding });
    get().persist();
  },
  setEncoding: (encoding) => {
    set({ encoding });
    get().persist();
  },
  setAutoReconnect: (autoReconnect) => {
    set({ autoReconnect });
    get().persist();
  },
  setAutoResumeMonitor: (autoResumeMonitor) => {
    set({ autoResumeMonitor });
    get().persist();
  },
  setAutoNavigateMonitorAfterFlash: (autoNavigateMonitorAfterFlash) => {
    set({ autoNavigateMonitorAfterFlash });
    get().persist();
  },
  toggleSidebar: () => {
    set({ sidebarExpanded: !get().sidebarExpanded });
    get().persist();
  },
  setShowSplash: (showSplash) => {
    set({ showSplash });
    get().persist();
  },
  applyTheme: () => {
    const { theme } = get();
    const resolved = theme === "system" ? getSystemTheme() : theme;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  },
  applyUiScale: () => {
    const { uiScale } = get();
    document.documentElement.style.fontSize = `${uiScale}px`;
  },
  persist: () => {
    const state = get();
    const toSave = {
      theme: state.theme,
      language: state.language,
      fontSize: state.fontSize,
      uiScale: state.uiScale,
      timestampEnabled: state.timestampEnabled,
      timestampFormat: state.timestampFormat,
      autoScroll: state.autoScroll,
      lineEnding: state.lineEnding,
      encoding: state.encoding,
      autoReconnect: state.autoReconnect,
      autoResumeMonitor: state.autoResumeMonitor,
      autoNavigateMonitorAfterFlash: state.autoNavigateMonitorAfterFlash,
      monitorMaxLines: state.monitorMaxLines,
      sidebarExpanded: state.sidebarExpanded,
      showSplash: state.showSplash,
    };
    localStorage.setItem("serial-helper-settings", JSON.stringify(toSave));
  },
}));
