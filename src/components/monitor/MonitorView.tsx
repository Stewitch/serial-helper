import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useSerialStore } from "@/stores/serialStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSerial } from "@/hooks/useSerial";
import { monitorBuffer } from "@/lib/monitorBuffer";
import { formatTimestamp } from "@/lib/formatTimestamp";
import { SERIAL_ENCODINGS } from "@/lib/textCodec";
import { Button, Segmented, ToolbarSep } from "@/components/ui";
import { MonitorOutput, type MonitorOutputHandle } from "./MonitorOutput";
import { SendInput } from "./SendInput";

const I = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.4 } as const;

export function MonitorView() {
  const { t } = useTranslation("monitor");
  const config = useSerialStore((s) => s.config);
  const isConnected = useSerialStore((s) => s.isConnected);
  const isPaused = useSerialStore((s) => s.isPaused);
  const setPaused = useSerialStore((s) => s.setPaused);
  const timestampEnabled = useSettingsStore((s) => s.timestampEnabled);
  const setTimestampEnabled = useSettingsStore((s) => s.setTimestampEnabled);
  const timestampFormat = useSettingsStore((s) => s.timestampFormat);
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScroll);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const encoding = useSettingsStore((s) => s.encoding);
  const setEncoding = useSettingsStore((s) => s.setEncoding);

  const logError = useCallback((err: string) => monitorBuffer.appendLine("error", err), []);
  const { send } = useSerial(logError);

  const outputRef = useRef<MonitorOutputHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchInfo, setMatchInfo] = useState({ count: 0, current: 0 });

  // Ctrl+F opens find, Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const handleSend = useCallback(
    (data: number[], display: string) => {
      void send(data);
      monitorBuffer.appendLine("tx", display);
    },
    [send]
  );

  const handleSaveLog = useCallback(async () => {
    const content = monitorBuffer
      .getLines()
      .map((l) => {
        const tag = l.type === "rx" ? "" : `[${l.type.toUpperCase()}] `;
        const ts = timestampEnabled ? `[${formatTimestamp(l.ts, timestampFormat)}] ` : "";
        return `${ts}${tag}${l.text}\n`;
      })
      .join("");
    if (!content) return;

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `${config.port_name || "serial"}-${stamp}.log`;

    if (isTauri()) {
      const path = await save({ defaultPath: filename, filters: [{ name: "Log", extensions: ["log", "txt"] }] });
      if (!path) return;
      try {
        await invoke("save_text_file", { path, content });
        monitorBuffer.appendLine("system", t("logSaved", { path }));
      } catch (e) {
        monitorBuffer.appendLine("error", t("logSaveFailed", { error: String(e) }));
      }
      return;
    }

    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [config.port_name, t, timestampEnabled, timestampFormat]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 h-11 px-3 border-b border-line shrink-0">
        <Button
          variant="ghost"
          pressed={isPaused}
          onClick={() => setPaused(!isPaused)}
          icon={
            isPaused ? (
              <svg {...I} fill="currentColor" stroke="none" aria-hidden><path d="M4 2.5l7.5 4.5L4 11.5z" /></svg>
            ) : (
              <svg {...I} fill="currentColor" stroke="none" aria-hidden><rect x="3" y="2" width="3" height="10" rx="1" /><rect x="8" y="2" width="3" height="10" rx="1" /></svg>
            )
          }
        >
          {isPaused ? t("resumeOutput") : t("pauseOutput")}
        </Button>
        <Button variant="ghost" onClick={() => monitorBuffer.clear()} icon={<svg {...I} aria-hidden><path d="M2.5 4h9M5.5 4V2.5h3V4M4 4l.6 7.5h4.8L10 4" /></svg>}>
          {t("clearOutput")}
        </Button>
        <Button variant="ghost" onClick={handleSaveLog} icon={<svg {...I} aria-hidden><path d="M7 2v7M4 6.5L7 9.5l3-3M2.5 12h9" /></svg>}>
          {t("saveLog")}
        </Button>

        <ToolbarSep />

        <Button
          variant="ghost"
          pressed={timestampEnabled}
          onClick={() => setTimestampEnabled(!timestampEnabled)}
          icon={<svg {...I} aria-hidden><circle cx="7" cy="7" r="5" /><path d="M7 4v3l2 1.5" /></svg>}
        >
          {t("common:timestamp")}
        </Button>
        <Button
          variant="ghost"
          pressed={autoScroll}
          onClick={() => setAutoScroll(!autoScroll)}
          icon={<svg {...I} aria-hidden><path d="M7 2v9M3.5 7.5L7 11l3.5-3.5" /></svg>}
        >
          {t("followLatest")}
        </Button>

        {searchOpen ? (
          <div className="flex items-center gap-1 h-[30px] pl-2.5 pr-1 ml-1 rounded border border-accent bg-raised">
            <svg {...I} className="text-ink-3 shrink-0" aria-hidden><circle cx="6" cy="6" r="3.5" /><path d="M8.5 8.5L12 12" /></svg>
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  outputRef.current?.stepMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  closeSearch();
                }
              }}
              placeholder={t("findPlaceholder")}
              aria-label={t("find")}
              className="w-36 bg-transparent text-sm font-mono text-ink placeholder:text-ink-3 placeholder:font-sans focus:outline-none"
            />
            <span className="text-xs text-ink-3 tabular-nums min-w-[3.5em] text-right">
              {query.trim() ? (matchInfo.count > 0 ? `${matchInfo.current} / ${matchInfo.count}` : t("noMatches")) : ""}
            </span>
            <button type="button" aria-label={t("prevMatch")} onClick={() => outputRef.current?.stepMatch(-1)} className="w-6 h-6 grid place-items-center rounded text-ink-2 hover:bg-base">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 7.5L6 4.5l3 3" /></svg>
            </button>
            <button type="button" aria-label={t("nextMatch")} onClick={() => outputRef.current?.stepMatch(1)} className="w-6 h-6 grid place-items-center rounded text-ink-2 hover:bg-base">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 4.5L6 7.5l3-3" /></svg>
            </button>
            <button type="button" aria-label={t("common:close")} onClick={closeSearch} className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:bg-base">
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
            </button>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setSearchOpen(true)}
            title="Ctrl+F"
            icon={<svg {...I} aria-hidden><circle cx="6" cy="6" r="3.5" /><path d="M8.5 8.5L12 12" /></svg>}
          >
            {t("find")}
          </Button>
        )}

        <span className="flex-1" />

        <Segmented
          aria-label={t("common:encoding")}
          value={encoding}
          onChange={setEncoding}
          options={SERIAL_ENCODINGS.map((e) => ({ value: e.value, label: e.label }))}
        />
      </div>

      <MonitorOutput
        ref={outputRef}
        paused={isPaused}
        autoScroll={autoScroll}
        timestampEnabled={timestampEnabled}
        timestampFormat={timestampFormat}
        fontSize={fontSize}
        query={searchOpen ? query : ""}
        onMatchesChange={setMatchInfo}
        emptyState={<EmptyState connected={isConnected} port={config.port_name} baud={config.baud_rate} />}
      />

      <SendInput onSend={handleSend} disabled={!isConnected} />
    </div>
  );
}

function EmptyState({ connected, port, baud }: { connected: boolean; port: string; baud: number }) {
  const { t } = useTranslation("monitor");
  return (
    <div className="h-full grid place-items-center font-sans">
      <div className="text-center max-w-xs">
        <p className="text-md text-ink-2">{connected ? t("waitingForData") : t("notConnected")}</p>
        <p className="mt-1.5 text-sm text-ink-3">
          {connected
            ? t("waitingForDataHint", { port, baud })
            : port
              ? t("notConnectedHint", { port })
              : t("noPortHint")}
        </p>
      </div>
    </div>
  );
}
