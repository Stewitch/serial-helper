import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useSerial } from "@/hooks/useSerial";
import { monitorBuffer } from "@/lib/monitorBuffer";
import { BAUD_RATES } from "@/types/serial";
import { FRAME_PRESETS, formatBytes, frameLabel, parseFrameLabel, portHint, sortPorts } from "@/lib/serialFormat";
import { Select, type SelectOption } from "@/components/ui";

/**
 * The one place to pick a port and connect. Shown above the monitor and flash
 * pages, which share the same port.
 */
export function ConnectionBar() {
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

  const portOptions: SelectOption[] = sortPorts(ports).map((p) => ({ value: p.name, label: p.name, hint: portHint(p) }));
  if (isPortLost && lostPortName && !ports.some((p) => p.name === lostPortName)) {
    portOptions.unshift({ value: lostPortName, label: lostPortName, hint: t("monitor:portLost") });
  }
  const baudOptions: SelectOption[] = BAUD_RATES.map((b) => ({ value: String(b), label: String(b) }));
  const frameOptions: SelectOption[] = FRAME_PRESETS.map((p) => ({ value: frameLabel(p), label: frameLabel(p) }));

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
    <div className="flex items-center gap-1.5 h-11 px-3 border-b border-line bg-chrome/60 shrink-0">
      <Select
        aria-label={t("common:port")}
        value={isPortLost ? lostPortName ?? "" : config.port_name}
        onChange={(v) => setConfig({ port_name: v })}
        options={portOptions}
        placeholder={t("monitor:noPortsFound")}
        disabled={locked}
        mono
        className="w-[200px]"
      />
      <Select
        aria-label={t("common:baudRate")}
        value={String(config.baud_rate)}
        onChange={(v) => setConfig({ baud_rate: parseInt(v, 10) })}
        options={baudOptions}
        disabled={locked}
        mono
        className="w-[104px]"
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
        className="w-[76px]"
      />
      <ConnectButton
        state={isFlashing ? "flashing" : isPortLost ? "lost" : isConnected ? "connected" : "idle"}
        disabled={busy || isFlashing || (!config.port_name && !isPortLost)}
        onClick={handleConnect}
      />
      <span className="flex-1" />
      <TrafficCounters />
    </div>
  );
}

/**
 * Session-wide serial housekeeping that must run whichever page is shown:
 * picks a default port and logs port loss once.
 */
export function useConnectionHousekeeping() {
  const { t } = useTranslation();
  const ports = useSerialStore((s) => s.ports);
  const portName = useSerialStore((s) => s.config.port_name);
  const setConfig = useSerialStore((s) => s.setConfig);
  const isConnected = useSerialStore((s) => s.isConnected);
  const lostPortName = useSerialStore((s) => s.lostPortName);
  const appState = useAppStore((s) => s.appState);
  const isPortLost = appState === "PORT_LOST";
  const locked = isConnected || isPortLost || appState === "FLASHING" || appState === "RESUMING_MONITOR";

  const lostLogged = useRef<string | null>(null);
  useEffect(() => {
    if (isPortLost && lostPortName && lostLogged.current !== lostPortName) {
      lostLogged.current = lostPortName;
      monitorBuffer.appendLine("warn", t("monitor:portLostLog", { port: lostPortName }));
    }
    if (!isPortLost) lostLogged.current = null;
  }, [isPortLost, lostPortName, t]);

  useEffect(() => {
    if (!portName && !locked && ports.length > 0) {
      setConfig({ port_name: sortPorts(ports)[0].name });
    }
  }, [portName, locked, ports, setConfig]);
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
        "inline-flex items-center gap-2 h-[30px] px-3.5 ml-1 rounded text-sm font-semibold shrink-0 transition-colors",
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
    <div className="flex items-center gap-4 font-mono text-xs text-ink-3">
      <Counter label="RX" value={rxBytes} active={rxActive} />
      <Counter label="TX" value={txBytes} active={txActive} />
    </div>
  );
}

function Counter({ label, value, active }: { label: string; value: number; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
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
