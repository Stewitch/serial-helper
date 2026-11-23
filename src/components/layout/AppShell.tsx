import { useEffect } from "react";
import { TitleBar } from "./TitleBar";
import { Rail } from "./Rail";
import { MonitorView } from "@/components/monitor/MonitorView";
import { FlashPanel } from "@/components/flash/FlashPanel";
import { ModuleManager } from "@/components/modules/ModuleManager";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useAppStore } from "@/stores/appStore";
import { useSerialReceiver } from "@/hooks/useSerialReceiver";
import { usePortScanner } from "@/hooks/usePortScanner";

export function AppShell() {
  const appState = useAppStore((s) => s.appState);
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);

  // Both run for the whole session, independent of which page is shown.
  usePortScanner();
  useSerialReceiver();

  useEffect(() => {
    if (appState === "FLASHING") setActivePage("flash");
  }, [appState, setActivePage]);

  return (
    <div className="grid h-full grid-cols-[56px_1fr] grid-rows-[44px_1fr] bg-base text-ink">
      <TitleBar />
      <Rail active={activePage} onNavigate={setActivePage} />
      <main className="flex flex-col min-w-0 min-h-0 overflow-hidden">
        {activePage === "monitor" && <MonitorView />}
        {activePage === "flash" && <FlashPanel />}
        {activePage === "modules" && <ModuleManager />}
        {activePage === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
