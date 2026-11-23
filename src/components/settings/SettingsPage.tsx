import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFlashStore } from "@/stores/flashStore";
import { FieldGroup, FieldRow, Segmented, Select, Switch } from "@/components/ui";
import { BrandMark } from "@/components/layout/BrandMark";

const appVersion = __APP_VERSION__;

export function SettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const s = useSettingsStore();
  const verify = useFlashStore((st) => st.verify);
  const setVerify = useFlashStore((st) => st.setVerify);
  const runAfter = useFlashStore((st) => st.runAfter);
  const setRunAfter = useFlashStore((st) => st.setRunAfter);

  const changeLanguage = (lang: string) => {
    s.setLanguage(lang);
    void i18n.changeLanguage(lang);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 py-7 space-y-7">
        <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>

        <FieldGroup title={t("appearance")}>
          <FieldRow label={t("theme")}>
            <Segmented
              aria-label={t("theme")}
              value={s.theme}
              onChange={s.setTheme}
              mono={false}
              options={[
                { value: "system", label: t("themeSystem") },
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("language")}>
            <Segmented
              aria-label={t("language")}
              value={s.language}
              onChange={changeLanguage}
              mono={false}
              options={[
                { value: "zh-CN", label: "中文" },
                { value: "en-US", label: "English" },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("uiScale")} hint={t("uiScaleDesc")}>
            <Stepper value={s.uiScale} min={12} max={18} onChange={s.setUiScale} unit="px" label={t("uiScale")} />
          </FieldRow>
        </FieldGroup>

        <FieldGroup title={t("monitorSettings")}>
          <FieldRow label={t("monitorFontSize")}>
            <Stepper value={s.fontSize} min={10} max={20} onChange={s.setFontSize} unit="px" label={t("monitorFontSize")} />
          </FieldRow>
          <FieldRow label={t("common:timestamp")} hint={t("timestampDesc")}>
            <Switch aria-label={t("common:timestamp")} checked={s.timestampEnabled} onChange={s.setTimestampEnabled} />
          </FieldRow>
          {s.timestampEnabled && (
            <FieldRow label={t("timestampFormat")} indent>
              <Select
                aria-label={t("timestampFormat")}
                value={s.timestampFormat}
                onChange={s.setTimestampFormat}
                mono
                className="w-[150px]"
                options={["HH:mm:ss.SSS", "HH:mm:ss", "mm:ss.SSS"].map((f) => ({ value: f, label: f }))}
              />
            </FieldRow>
          )}
          <FieldRow label={t("monitor:followLatest")} hint={t("autoScrollDesc")}>
            <Switch aria-label={t("monitor:followLatest")} checked={s.autoScroll} onChange={s.setAutoScroll} />
          </FieldRow>
          <FieldRow label={t("monitor:autoReconnect")} hint={t("autoReconnectDesc")}>
            <Switch aria-label={t("monitor:autoReconnect")} checked={s.autoReconnect} onChange={s.setAutoReconnect} />
          </FieldRow>
        </FieldGroup>

        <FieldGroup title={t("flashDefaults")}>
          <FieldRow label={t("flashVerify")} hint={t("flashVerifyDesc")}>
            <Switch aria-label={t("flashVerify")} checked={verify} onChange={setVerify} />
          </FieldRow>
          <FieldRow label={t("flashRunAfter")} hint={t("flashRunAfterDesc")}>
            <Switch aria-label={t("flashRunAfter")} checked={runAfter} onChange={setRunAfter} />
          </FieldRow>
          <FieldRow label={t("flashResumeMonitor")} hint={t("flashResumeMonitorDesc")}>
            <Switch aria-label={t("flashResumeMonitor")} checked={s.autoResumeMonitor} onChange={s.setAutoResumeMonitor} />
          </FieldRow>
          {s.autoResumeMonitor && (
            <FieldRow label={t("flashNavigateMonitor")} hint={t("flashNavigateMonitorDesc")} indent>
              <Switch aria-label={t("flashNavigateMonitor")} checked={s.autoNavigateMonitorAfterFlash} onChange={s.setAutoNavigateMonitorAfterFlash} />
            </FieldRow>
          )}
        </FieldGroup>

        <FieldGroup title={t("about")}>
          <div className="flex items-center gap-3 py-1">
            <BrandMark size={28} />
            <div>
              <p className="m-0 text-md font-semibold">SerialHelper</p>
              <p className="m-0 text-xs text-ink-3 font-mono">v{appVersion}</p>
            </div>
          </div>
        </FieldGroup>
      </div>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  unit,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit: string;
  label: string;
}) {
  const btn = "w-7 h-full grid place-items-center text-ink-2 hover:text-ink hover:bg-raised disabled:opacity-30 disabled:pointer-events-none";
  return (
    <div role="group" aria-label={label} className="inline-flex items-center h-[30px] rounded border border-line bg-base overflow-hidden">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="−">
        <svg width="10" height="10" aria-hidden><path d="M1 5h8" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <span className="w-14 text-center font-mono text-sm tabular-nums" aria-live="polite">
        {value}
        <span className="text-ink-3">{unit}</span>
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="+">
        <svg width="10" height="10" aria-hidden><path d="M1 5h8M5 1v8" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
  );
}
