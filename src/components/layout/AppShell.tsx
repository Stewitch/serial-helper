import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { MonitorView } from "@/components/monitor/MonitorView";
import { FlashPanel } from "@/components/flash/FlashPanel";
import { ModuleManager } from "@/components/modules/ModuleManager";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useAppStore } from "@/stores/appStore";

export function AppShell() {
  const appState = useAppStore((s) => s.appState);
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);

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
          {activePage === "modules" && <ModuleManager />}
          {activePage === "settings" && <SettingsPage />}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
