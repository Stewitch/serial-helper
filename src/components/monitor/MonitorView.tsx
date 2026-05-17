import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSerial } from "@/hooks/useSerial";
import { PortSelector } from "@/components/shared/PortSelector";
import { BaudRateInput } from "@/components/shared/BaudRateInput";
import { MonitorToolbar } from "./MonitorToolbar";
import { SendInput } from "./SendInput";
import { Monitor } from "lucide-react";
import clsx from "clsx";

interface LogLine {
  id: number;
  text: string;
  type: "rx" | "tx" | "system" | "error" | "warn";
  timestamp: number;
}

// Module-level — survives page navigation (component mount/unmount)
let globalLines: LogLine[] = [];
let globalLineId = 0;
const MAX_LINES = 50000;

function pushLine(line: LogLine) {
  globalLines.push(line);
  if (globalLines.length > MAX_LINES) {
    globalLines = globalLines.slice(globalLines.length - MAX_LINES);
  }
}

export function MonitorView() {
  const { t } = useTranslation();
  const config = useSerialStore((s) => s.config);
  const setConfig = useSerialStore((s) => s.setConfig);
  const isConnected = useSerialStore((s) => s.isConnected);
  const lostPortName = useSerialStore((s) => s.lostPortName);
  const setConnected = useSerialStore((s) => s.setConnected);
  const isPaused = useSerialStore((s) => s.isPaused);
  const setPaused = useSerialStore((s) => s.setPaused);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);
  const timestampEnabled = useSettingsStore((s) => s.timestampEnabled);
  const timestampFormat = useSettingsStore((s) => s.timestampFormat);
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // Sync from global buffer for React reactivity
  const [tick, setTick] = useState(0);
  const lines = globalLines;
  const outputRef = useRef<HTMLDivElement>(null);
  const textDecoderRef = useRef(new TextDecoder());

  const addLine = useCallback((text: string, type: LogLine["type"]) => {
    pushLine({
      id: globalLineId++,
      text: text + "\n",
      type,
      timestamp: Date.now(),
    });
    setTick((t) => t + 1);
  }, []);

  const handleData = useCallback(
    (data: number[], ts: number) => {
      const text = textDecoderRef.current.decode(new Uint8Array(data));
      pushLine({ id: globalLineId++, text, type: "rx", timestamp: ts });
      setTick((t) => t + 1);
    },
    []
  );

  const handleSerialError = useCallback(
    (err: string) => {
      addLine(err, "error");
    },
    [addLine]
  );

  const { connect, disconnect, send } = useSerial(handleData, handleSerialError);

  const portLostLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (appState === "PORT_LOST" && lostPortName && portLostLoggedRef.current !== lostPortName) {
      portLostLoggedRef.current = lostPortName;
      addLine(`Port ${lostPortName} disconnected — waiting for reconnect...`, "warn");
    }
    if (appState !== "PORT_LOST") {
      portLostLoggedRef.current = null;
    }
  }, [appState, lostPortName, addLine]);

  const handleSend = useCallback(
    (data: number[]) => {
      send(data);
      const text = new TextDecoder().decode(new Uint8Array(data));
      pushLine({ id: globalLineId++, text, type: "tx", timestamp: Date.now() });
      setTick((t) => t + 1);
    },
    [send]
  );

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      await disconnect();
      addLine("Disconnected", "system");
    } else if (appState === "PORT_LOST") {
      setConnected(null);
      setState("IDLE");
    } else {
      if (!config.port_name) return;
      const err = await connect(config);
      if (err) {
        addLine(err, "error");
      }
    }
  }, [isConnected, appState, config, connect, disconnect, setConnected, setState, addLine]);

  const handleClear = useCallback(() => {
    globalLines = [];
    globalLineId = 0;
    setTick((t) => t + 1);
  }, []);

  const handleSaveLog = useCallback(async () => {
    const content = lines
      .map((l) => {
        const prefix =
          l.type === "tx" ? "[TX] " :
          l.type === "error" ? "[ERROR] " :
          l.type === "warn" ? "[WARN] " :
          l.type === "system" ? "[SYS] " : "";
        const ts = timestampEnabled
          ? `[${formatTimestamp(l.timestamp, timestampFormat)}] `
          : "";
        return `${ts}${prefix}${l.text}`;
      })
      .join("");

    if (!content) return;

    const filename = `serial-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "Log files", accept: { "text/plain": [".log", ".txt"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return;
      }
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    a.style.position = "fixed";
    a.style.top = "-100px";
    document.body.appendChild(a);
    setTimeout(() => {
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    }, 0);
  }, [lines, timestampEnabled, timestampFormat]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [tick, autoScroll]);

  const isFlashing = appState === "FLASHING";
  const isPortLost = appState === "PORT_LOST";

  const buttonLabel = (() => {
    if (isPortLost) return t("monitor:cancelReconnect");
    if (isConnected) return t("common:disconnect");
    return t("common:connect");
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
          <Monitor size={14} className="text-accent" />
          {t("monitor:title")}
        </h2>
      </div>

      {/* Connection Toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-surface-alt/50">
        <PortSelector
          value={isPortLost ? lostPortName || "" : config.port_name}
          onChange={(port) => setConfig({ port_name: port })}
          disabled={isConnected || isPortLost || isFlashing}
          portLost={isPortLost}
        />
        <BaudRateInput
          value={config.baud_rate}
          onChange={(baud) => setConfig({ baud_rate: baud })}
          disabled={isConnected || isPortLost || isFlashing}
        />
        <div className="w-px h-5 bg-border mx-0.5" />
        <button
          onClick={handleConnect}
          disabled={isFlashing || (!config.port_name && !isPortLost)}
          className={clsx(
            "h-7 px-4 text-xs font-medium rounded transition-colors shrink-0",
            isPortLost
              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20"
              : isConnected
                ? "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20"
                : "bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {buttonLabel}
        </button>
      </div>

      {/* Port Lost Warning */}
      {isPortLost && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/5 border-b border-yellow-500/20 text-[0.6875rem] text-yellow-600 dark:text-yellow-400">
          <span>⚠</span>
          <span>{t("monitor:portLostDesc", { port: lostPortName })}</span>
        </div>
      )}

      {/* Toolbar */}
      <MonitorToolbar
        isPaused={isPaused}
        onTogglePause={() => setPaused(!isPaused)}
        onClear={handleClear}
        onSaveLog={handleSaveLog}
        timestampEnabled={timestampEnabled}
        onToggleTimestamp={() =>
          useSettingsStore.getState().setTimestampEnabled(!timestampEnabled)
        }
      />

      {/* Output Area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto font-mono select-text bg-surface"
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
            <div className="text-3xl opacity-30">
              {isConnected ? "📡" : "🔌"}
            </div>
            <p className="text-xs">
              {isConnected
                ? t("monitor:waitingForData")
                : t("monitor:notConnected")}
            </p>
            {!isConnected && (
              <p className="text-[0.6875rem] text-text-muted/60 max-w-48 text-center">
                {config.port_name
                  ? `${config.port_name} @ ${config.baud_rate}`
                  : t("common:port") + ": —"}
              </p>
            )}
          </div>
        ) : (
          lines.map((line) => (
            <OutputLine
              key={line.id}
              line={line}
              timestampEnabled={timestampEnabled}
              timestampFormat={timestampFormat}
            />
          ))
        )}
      </div>

      {/* Paused overlay */}
      {isPaused && lines.length > 0 && (
        <div className="flex items-center justify-center py-0.5 bg-yellow-500/10 border-t border-yellow-500/20 text-[0.625rem] text-yellow-600 dark:text-yellow-400 font-medium">
          {t("monitor:pauseOutput")} — {t("monitor:resumeOutput")}
        </div>
      )}

      <SendInput onSend={handleSend} disabled={!isConnected} />
    </div>
  );
}

function OutputLine({
  line,
  timestampEnabled,
  timestampFormat,
}: {
  line: LogLine;
  timestampEnabled: boolean;
  timestampFormat: string;
}) {
  const colorClass =
    line.type === "rx"
      ? "text-monitor-rx"
      : line.type === "tx"
        ? "text-monitor-tx"
        : line.type === "error"
          ? "text-flash-error font-semibold"
          : line.type === "warn"
            ? "text-monitor-system font-semibold"
            : "text-monitor-system italic";

  return (
    <div
      className={clsx(
        "px-3 py-px hover:bg-surface-hover/50 transition-colors",
        colorClass
      )}
    >
      {timestampEnabled && (
        <span className="text-monitor-timestamp select-none">
          [{formatTimestamp(line.timestamp, timestampFormat)}]
        </span>
      )}
      {line.type === "tx" && (
        <span className="text-monitor-tx/70 font-semibold select-none">
          {" [TX] "}
        </span>
      )}
      {line.type === "error" && (
        <span className="text-flash-error font-bold select-none">
          {" [ERROR] "}
        </span>
      )}
      {line.type === "warn" && (
        <span className="text-monitor-system font-bold select-none">
          {" [WARN] "}
        </span>
      )}
      {line.type === "system" && (
        <span className="text-monitor-system font-semibold select-none">
          {" [SYS] "}
        </span>
      )}
      <span className="whitespace-pre-wrap break-all">{line.text}</span>
    </div>
  );
}

function formatTimestamp(ts: number, format: string): string {
  const d = new Date(ts);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return format
    .replace("HH", pad(d.getHours(), 2))
    .replace("mm", pad(d.getMinutes(), 2))
    .replace("ss", pad(d.getSeconds(), 2))
    .replace("SSS", pad(d.getMilliseconds(), 3));
}
