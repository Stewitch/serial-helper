import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAppStore } from "@/stores/appStore";
import { AppShell } from "@/components/layout/AppShell";

export default function App() {
  const applyTheme = useSettingsStore((s) => s.applyTheme);
  const applyUiScale = useSettingsStore((s) => s.applyUiScale);
  const setState = useAppStore((s) => s.setState);

  useEffect(() => {
    applyTheme();
    applyUiScale();
    setState("IDLE");
  }, [applyTheme, applyUiScale, setState]);

  return <AppShell />;
}
