import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useSerial } from "@/hooks/useSerial";
import { monitorBuffer } from "@/lib/monitorBuffer";
import { BAUD_RATES } from "@/types/serial";
import { FRAME_PRESETS, formatBytes, frameLabel, parseFrameLabel, portHint, sortPorts } from "@/lib/serialFormat";
import { Select, type SelectOption } from "@/components/ui";
import { BrandMark } from "./BrandMark";

const inTauri = isTauri();

export function TitleBar() {
  const { t } = useTranslation();
  const ports = useSerialStore((s) => s.ports);
  const config = useSerialStore((s) => s.config);
  const setConfig = useSerialStore((s) => s.setConfig);
  const isConnected = useSerialStore((s) => s.isConnected);
  const lostPortName = useSerialStore((s) => s.lostPortName);
  const setConnected = useSerialStore((s) => s.setConnected);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);

  const logError = useCallback((msg: string) => monitorBuffer.appendLine("error", msg), []);
  const { connect, disconnect } = useSerial(logError);
  const [busy, setBusy] = useState(false);

  const isFlashing = appState === "FLASHING" || appState === "RESUMING_MONITOR";
  const isPortLost = appState === "PORT_LOST";
  const locked = isConnected || isPortLost || isFlashing;

  const portOptions: SelectOption[] = sortPorts(ports).map((p) => ({
    value: p.name,
    label: p.name,
    hint: portHint(p),
  }));
  if (isPortLost && lostPortName && !ports.some((p) => p.name === lostPortName)) {
    portOptions.unshift({ value: lostPortName, label: lostPortName, hint: t("monitor:portLost") });
  }
  const baudOptions: SelectOption[] = BAUD_RATES.map((b) => ({ value: String(b), label: String(b) }));
  const frameOptions: SelectOption[] = FRAME_PRESETS.map((p) => ({ value: frameLabel(p), label: frameLabel(p) }));

  // Log port loss once per event. Lives here because the title bar is always mounted.
  const lostLogged = useRef<string | null>(null);
  useEffect(() => {
    if (isPortLost && lostPortName && lostLogged.current !== lostPortName) {
      lostLogged.current = lostPortName;
      monitorBuffer.appendLine("warn", t("monitor:portLostLog", { port: lostPortName }));
    }
    if (!isPortLost) lostLogged.current = null;
  }, [isPortLost, lostPortName, t]);

  // Pick the first port automatically when nothing is selected yet.
  useEffect(() => {
    if (!config.port_name && !locked && ports.length > 0) {
      setConfig({ port_name: sortPorts(ports)[0].name });
    }
  }, [config.port_name, locked, ports, setConfig]);

  const handleConnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isConnected) {
        await disconnect();
        monitorBuffer.appendLine("system", t("monitor:disconnectedLog"));
      } else if (isPortLost) {
        setConnected(null);
        setState("IDLE");
      } else if (config.port_name) {
        monitorBuffer.resetDecoder();
        const err = await connect(config);
        if (!err) {
          monitorBuffer.appendLine(
            "system",
            t("monitor:connectedLog", { port: config.port_name, baud: config.baud_rate, frame: frameLabel(config) })
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (inTauri && e.target === e.currentTarget) void getCurrentWindow().toggleMaximize();
      }}
      className="col-span-2 flex items-center h-11 bg-chrome border-b border-line select-none"
    >
      <div data-tauri-drag-region className="w-14 self-stretch grid place-items-center shrink-0" title="SerialHelper">
        <BrandMark />
      </div>

      <div className="flex items-center gap-1.5 pl-1">
        <Select
          aria-label={t("common:port")}
          value={isPortLost ? lostPortName ?? "" : config.port_name}
          onChange={(v) => setConfig({ port_name: v })}
          options={portOptions}
          placeholder={t("monitor:noPortsFound")}
          disabled={locked}
          mono
          className="w-[184px]"
        />
        <Select
          aria-label={t("common:baudRate")}
          value={String(config.baud_rate)}
          onChange={(v) => setConfig({ baud_rate: parseInt(v, 10) })}
          options={baudOptions}
          disabled={locked}
          mono
          className="w-[98px]"
        />
        <Select
          aria-label={t("common:format")}
          value={frameLabel(config)}
          onChange={(v) => {
            const preset = parseFrameLabel(v);
            if (preset) setConfig(preset);
          }}
          options={frameOptions}
          disabled={locked}
          mono
          className="w-[70px]"
        />
        <ConnectButton
          state={isFlashing ? "flashing" : isPortLost ? "lost" : isConnected ? "connected" : "idle"}
          disabled={busy || isFlashing || (!config.port_name && !isPortLost)}
          onClick={handleConnect}
        />
      </div>

      <div data-tauri-drag-region className="flex-1 self-stretch" />

      <TrafficCounters />

      {inTauri && <WindowControls />}
    </header>
  );
}

function ConnectButton({
  state,
  disabled,
  onClick,
}: {
  state: "idle" | "connected" | "lost" | "flashing";
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const label = {
    idle: t("common:connect"),
    connected: t("common:disconnect"),
    lost: t("monitor:cancelReconnect"),
    flashing: t("flash:flashingNow"),
  }[state];
  const dot = {
    idle: null,
    connected: "bg-ok shadow-[0_0_0_3px_rgb(var(--ok)/0.22)]",
    lost: "bg-warn shadow-[0_0_0_3px_rgb(var(--warn)/0.22)] animate-pulse",
    flashing: "bg-accent shadow-[0_0_0_3px_rgb(var(--accent)/0.22)] animate-pulse",
  }[state];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && state !== "flashing"}
      aria-disabled={disabled}
      className={clsx(
        "inline-flex items-center gap-2 h-[30px] px-3.5 rounded text-sm font-semibold shrink-0 transition-colors",
        state === "idle"
          ? "bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-40"
          : "border border-line-strong text-ink hover:bg-raised",
        state === "flashing" && "pointer-events-none"
      )}
    >
      {dot && <span className={clsx("w-[7px] h-[7px] rounded-full", dot)} />}
      {label}
    </button>
  );
}

function TrafficCounters() {
  const rxBytes = useSerialStore((s) => s.rxBytes);
  const txBytes = useSerialStore((s) => s.txBytes);
  const rxActive = useActivity(rxBytes);
  const txActive = useActivity(txBytes);

  return (
    <div data-tauri-drag-region className="flex items-center gap-4 pr-4 font-mono text-xs text-ink-3">
      <Counter label="RX" value={rxBytes} active={rxActive} />
      <Counter label="TX" value={txBytes} active={txActive} />
    </div>
  );
}

function Counter({ label, value, active }: { label: string; value: number; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 pointer-events-none">
      <i className={clsx("w-1.5 h-1.5 rounded-[1px]", active ? "bg-ok" : "bg-line-strong")} />
      {label}
      <b className="font-normal text-ink-2 tabular-nums">{formatBytes(value)}</b>
    </span>
  );
}

/** True for a short moment after `value` changes, like an activity LED. */
function useActivity(value: number) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (value === 0) return;
    setActive(true);
    const timer = setTimeout(() => setActive(false), 180);
    return () => clearTimeout(timer);
  }, [value]);
  return active;
}

function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const base = "w-[46px] self-stretch grid place-items-center text-ink-2 transition-colors";
  return (
    <div className="flex self-stretch">
      <button type="button" aria-label={t("common:minimize")} className={clsx(base, "hover:bg-raised")} onClick={() => void getCurrentWindow().minimize()}>
        <svg width="10" height="10" aria-hidden><path d="M0 5.5h10" stroke="currentColor" /></svg>
      </button>
      <button type="button" aria-label={maximized ? t("common:restore") : t("common:maximize")} className={clsx(base, "hover:bg-raised")} onClick={() => void getCurrentWindow().toggleMaximize()}>
        {maximized ? (
          <svg width="10" height="10" aria-hidden fill="none" stroke="currentColor"><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg>
        ) : (
          <svg width="10" height="10" aria-hidden><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
        )}
      </button>
      <button type="button" aria-label={t("common:close")} className={clsx(base, "hover:bg-[#C42B1C] hover:text-white")} onClick={() => void getCurrentWindow().close()}>
        <svg width="10" height="10" aria-hidden><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  );
}
