import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { Pause, Play, Trash2, Download, Clock, ArrowDown } from "lucide-react";
import { ThemeSelect } from "@/components/shared/ThemeSelect";
import type { SelectOption } from "@/components/shared/ThemeSelect";
import clsx from "clsx";

interface MonitorToolbarProps {
  isPaused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  onSaveLog: () => void;
  timestampEnabled: boolean;
  onToggleTimestamp: () => void;
}

export function MonitorToolbar({
  isPaused,
  onTogglePause,
  onClear,
  onSaveLog,
  timestampEnabled,
  onToggleTimestamp,
}: MonitorToolbarProps) {
  const { t } = useTranslation("monitor");
  const commonT = useTranslation("common").t;
  const { lineEnding, setLineEnding } = useSettingsStore();
  const { encoding, setEncoding } = useSettingsStore();
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScroll);

  const btnBase =
    "flex items-center gap-1 px-2 h-6 text-[0.6875rem] rounded border transition-colors";
  const btnOff = "bg-surface border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary";
  const btnOn = "bg-accent border-accent text-white hover:bg-accent-hover";

  const lineEndingOptions: SelectOption[] = [
    { value: "CRLF", label: "CRLF" },
    { value: "LF", label: "LF" },
    { value: "CR", label: "CR" },
  ];

  const encodingOptions: SelectOption[] = [
    { value: "UTF-8", label: "UTF-8" },
    { value: "GB2312", label: "GB2312" },
    { value: "Latin1", label: "Latin1" },
    { value: "Shift-JIS", label: "Shift-JIS" },
  ];

  return (
    <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-border bg-surface-alt/50">
      {/* Pause / Resume — toggle */}
      <button onClick={onTogglePause} className={clsx(btnBase, isPaused ? btnOn : btnOff)}>
        {isPaused ? <Play size={13} /> : <Pause size={13} />}
        <span>{isPaused ? t("resumeOutput") : t("pauseOutput")}</span>
      </button>

      <button onClick={onClear} className={clsx(btnBase, btnOff)}>
        <Trash2 size={13} />
        <span>{t("clearOutput")}</span>
      </button>

      <button onClick={onSaveLog} className={clsx(btnBase, btnOff)}>
        <Download size={13} />
        <span>{t("saveLog")}</span>
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Timestamp — toggle */}
      <button onClick={onToggleTimestamp} className={clsx(btnBase, timestampEnabled ? btnOn : btnOff)}>
        <Clock size={13} />
        <span>{commonT("timestamp")}</span>
      </button>

      {/* Auto-scroll — toggle */}
      <button onClick={() => setAutoScroll(!autoScroll)} className={clsx(btnBase, autoScroll ? btnOn : btnOff)}>
        <ArrowDown size={13} />
        <span>{commonT("autoscroll")}</span>
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      <ThemeSelect
        value={lineEnding}
        onChange={(v) => setLineEnding(v as "CRLF" | "LF" | "CR")}
        options={lineEndingOptions}
        className="w-[64px]"
      />

      <ThemeSelect
        value={encoding}
        onChange={setEncoding}
        options={encodingOptions}
        className="w-[80px]"
      />
    </div>
  );
}
