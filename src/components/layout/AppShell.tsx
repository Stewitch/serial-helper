import { useEffect } from "react";
import { TitleBar } from "./TitleBar";
import { Rail } from "./Rail";
import { ConnectionBar, useConnectionHousekeeping } from "./ConnectionBar";
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

  // These run for the whole session, independent of which page is shown.
  usePortScanner();
  useSerialReceiver();
  useConnectionHousekeeping();

  useEffect(() => {
    if (appState === "FLASHING") setActivePage("flash");
  }, [appState, setActivePage]);

  const usesPort = activePage === "monitor" || activePage === "flash";

  return (
    // Rows size to their content so the title bar can never overlap the page,
    // whatever the UI scale.
    <div className="grid h-full grid-cols-[56px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-base text-ink">
      <TitleBar />
      <Rail active={activePage} onNavigate={setActivePage} />
      <main className="flex flex-col min-w-0 min-h-0 overflow-hidden">
        {usesPort && <ConnectionBar />}
        <div className="flex-1 min-h-0 flex flex-col">
          {activePage === "monitor" && <MonitorView />}
          {activePage === "flash" && <FlashPanel />}
          {activePage === "modules" && <ModuleManager />}
          {activePage === "settings" && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}
