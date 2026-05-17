import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { MonitorView } from "@/components/monitor/MonitorView";
import { FlashPanel } from "@/components/flash/FlashPanel";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useAppStore } from "@/stores/appStore";
import clsx from "clsx";

type Page = "monitor" | "flash" | "settings";

export function AppShell() {
  const [activePage, setActivePage] = useState<Page>("monitor");
  const appState = useAppStore((s) => s.appState);

  const isFlashing = appState === "FLASHING";

  useEffect(() => {
    if (isFlashing) {
      setActivePage("flash");
    }
  }, [isFlashing]);

  return (
    <div className="flex flex-col h-full bg-surface theme-transition select-none">
      {/* Title Bar */}
      <header className="flex items-center h-9 px-3 bg-surface-alt border-b border-border drag-region">
        <h1 className="text-[0.6875rem] font-semibold tracking-wide text-text-primary">
          SerialHelper
        </h1>
        <div className="ml-auto flex items-center gap-2 no-drag">
          <span
            className={clsx(
              "text-[0.625rem] px-1.5 py-0.5 rounded-full",
              appState === "MONITORING"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : appState === "FLASHING"
                  ? "bg-flash/10 text-flash"
                  : "bg-text-muted/10 text-text-muted"
            )}
          >
            {appState === "IDLE"
              ? "IDLE"
              : isFlashing
                ? "FLASH"
                : appState === "MONITORING"
                  ? "LIVE"
                  : appState}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <main className="flex-1 flex flex-col overflow-hidden bg-surface theme-transition">
          {activePage === "monitor" && <MonitorView />}
          {activePage === "flash" && <FlashPanel />}
          {activePage === "settings" && <SettingsPage />}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
