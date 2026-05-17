import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { Sun, Moon, Monitor, Type, Clock, ArrowDown, Link, Globe, AlignLeft } from "lucide-react";
import { Toggle } from "@/components/shared/Toggle";
import { ThemeSelect } from "@/components/shared/ThemeSelect";
import type { SelectOption } from "@/components/shared/ThemeSelect";

export function SettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const commonT = useTranslation("common").t;
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const timestampEnabled = useSettingsStore((s) => s.timestampEnabled);
  const setTimestampEnabled = useSettingsStore((s) => s.setTimestampEnabled);
  const timestampFormat = useSettingsStore((s) => s.timestampFormat);
  const setTimestampFormat = useSettingsStore((s) => s.setTimestampFormat);
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScroll);
  const autoReconnect = useSettingsStore((s) => s.autoReconnect);
  const setAutoReconnect = useSettingsStore((s) => s.setAutoReconnect);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const sectionClass = "p-4 border-b border-border theme-transition";
  const sectionTitleClass = "text-xs font-semibold text-text-primary mb-3 tracking-wide flex items-center gap-2";
  const rowClass = "flex items-center justify-between py-2";
  const labelClass = "text-[0.6875rem] text-text-secondary";
  const hintClass = "text-[0.625rem] text-text-muted mt-0.5";
  const languageOptions: SelectOption[] = [
    { value: "zh-CN", label: "中文" },
    { value: "en-US", label: "English" },
  ];

  const timestampFormatOptions: SelectOption[] = [
    { value: "HH:mm:ss.SSS", label: "HH:mm:ss.SSS" },
    { value: "HH:mm:ss", label: "HH:mm:ss" },
    { value: "mm:ss.SSS", label: "mm:ss.SSS" },
  ];

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide">
          {t("title")}
        </h2>
      </div>

      {/* Appearance */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>
          <Monitor size={14} className="text-text-muted" />
          {t("appearance")}
        </h3>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Sun size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{t("theme")}</span>
              <p className={hintClass}>
                {theme === "light"
                  ? t("themeLight")
                  : theme === "dark"
                    ? t("themeDark")
                    : t("themeSystem")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {(["system", "light", "dark"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setTheme(opt)}
                className={`h-6 px-2 text-[0.625rem] rounded border transition-colors flex items-center gap-1 ${
                  theme === opt
                    ? "bg-accent/10 border-accent/40 text-accent"
                    : "bg-surface border-border text-text-muted hover:bg-surface-hover"
                }`}
              >
                {opt === "system" && <Monitor size={11} />}
                {opt === "light" && <Sun size={11} />}
                {opt === "dark" && <Moon size={11} />}
                {t(`theme${opt === "dark" ? "Dark" : opt === "light" ? "Light" : "System"}`)}
              </button>
            ))}
          </div>
        </div>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{t("language")}</span>
              <p className={hintClass}>{t("languageDesc")}</p>
            </div>
          </div>
          <ThemeSelect
            value={language}
            onChange={handleLanguageChange}
            options={languageOptions}
            className="min-w-[100px]"
          />
        </div>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Type size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{t("uiScale")}</span>
              <p className={hintClass}>{t("uiScaleDesc")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={12}
              max={18}
              value={uiScale}
              onChange={(e) => setUiScale(parseInt(e.target.value))}
              className="w-20 h-1 accent-accent"
            />
            <span className="text-[0.625rem] text-text-muted w-8 font-mono">
              {uiScale}px
            </span>
          </div>
        </div>
      </div>

      {/* Monitor */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>
          <Type size={14} className="text-text-muted" />
          {t("monitorSettings")}
        </h3>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Type size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{commonT("fontSize")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={20}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-20 h-1 accent-accent"
            />
            <span className="text-[0.625rem] text-text-muted w-8 font-mono">
              {fontSize}px
            </span>
          </div>
        </div>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{commonT("timestamp")}</span>
              <p className={hintClass}>{t("timestampDesc")}</p>
            </div>
          </div>
          <Toggle active={timestampEnabled} onClick={() => setTimestampEnabled(!timestampEnabled)} />
        </div>

        {timestampEnabled && (
          <div className="ml-6 flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <AlignLeft size={12} className="text-text-muted" />
              <span className="text-[0.6875rem] text-text-muted">{commonT("format")}</span>
            </div>
            <ThemeSelect
              value={timestampFormat}
              onChange={setTimestampFormat}
              options={timestampFormatOptions}
              className="min-w-[130px]"
            />
          </div>
        )}

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <ArrowDown size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{commonT("autoscroll")}</span>
              <p className={hintClass}>{t("autoScrollDesc")}</p>
            </div>
          </div>
          <Toggle active={autoScroll} onClick={() => setAutoScroll(!autoScroll)} />
        </div>

        <div className={rowClass}>
          <div className="flex items-center gap-2">
            <Link size={13} className="text-text-muted" />
            <div>
              <span className={labelClass}>{t("autoReconnect", { ns: "monitor" }) || "Auto Reconnect"}</span>
              <p className={hintClass}>{t("autoReconnectDesc")}</p>
            </div>
          </div>
          <Toggle active={autoReconnect} onClick={() => setAutoReconnect(!autoReconnect)} />
        </div>
      </div>

      {/* Flash Defaults Placeholder */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{t("flashDefaults")}</h3>
        <p className="text-[0.6875rem] text-text-muted">
          Flash settings will be available in Phase 2.
        </p>
      </div>

      {/* About */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{t("about")}</h3>
        <p className="text-[0.6875rem] text-text-secondary font-mono">
          SerialHelper v0.1.0
        </p>
        <p className="text-[0.625rem] text-text-muted mt-1">
          Tauri 2.x + React 18 + Rust
        </p>
      </div>
    </div>
  );
}
