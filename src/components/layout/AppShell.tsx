import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { MonitorView } from "@/components/monitor/MonitorView";
import { FlashPanel } from "@/components/flash/FlashPanel";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useAppStore } from "@/stores/appStore";

type Page = "monitor" | "flash" | "settings";

export function AppShell() {
  const [activePage, setActivePage] = useState<Page>("monitor");
  const appState = useAppStore((s) => s.appState);

  useEffect(() => {
    if (appState === "FLASHING") {
      setActivePage("flash");
    }
  }, [appState]);

  return (
    <div className="flex flex-col h-full bg-surface theme-transition select-none">
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
