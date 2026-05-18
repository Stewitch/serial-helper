import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import clsx from "clsx";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSerialConfig(config: ReturnType<typeof useSerialStore.getState>["config"]): string {
  const db =
    config.data_bits === "Eight"
      ? "8"
      : config.data_bits === "Seven"
        ? "7"
        : config.data_bits === "Six"
          ? "6"
          : "5";
  const parity =
    config.parity === "None" ? "N" : config.parity === "Even" ? "E" : "O";
  const sb = config.stop_bits === "One" ? "1" : "2";
  return `${config.baud_rate}-${db}${parity}${sb}`;
}

function statusDot(appState: string): string {
  switch (appState) {
    case "MONITORING":
      return "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]";
    case "FLASHING":
      return "bg-flash shadow-[0_0_5px_rgba(217,70,239,0.5)] animate-pulse";
    case "RESUMING_MONITOR":
      return "bg-accent shadow-[0_0_5px_rgba(59,130,246,0.5)] animate-pulse";
    case "FLASH_ERROR":
    case "PORT_LOST":
      return "bg-flash-error shadow-[0_0_5px_rgba(220,38,38,0.5)]";
    default:
      return "bg-text-muted";
  }
}

export function StatusBar() {
  const connectedPort = useSerialStore((s) => s.connectedPort);
  const config = useSerialStore((s) => s.config);
  const rxBytes = useSerialStore((s) => s.rxBytes);
  const txBytes = useSerialStore((s) => s.txBytes);
  const appState = useAppStore((s) => s.appState);

  const stateLabel = (() => {
    switch (appState) {
      case "MONITORING": return "LIVE";
      case "FLASHING": return "FLASH";
      case "RESUMING_MONITOR": return "RESUME";
      case "FLASH_ERROR": return "ERROR";
      case "PORT_LOST": return "LOST";
      case "READY_TO_FLASH": return "READY";
      default: return "IDLE";
    }
  })();

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-surface-alt border-t border-border text-[0.625rem] text-text-muted select-none theme-transition">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className={clsx("w-1.5 h-1.5 rounded-full", statusDot(appState))}
          />
          <span className="font-medium text-text-secondary">{stateLabel}</span>
        </span>
        {connectedPort && (
          <>
            <span className="text-border-strong">|</span>
            <span className="font-mono text-text-secondary">
              {connectedPort}
            </span>
            <span className="font-mono">
              {formatSerialConfig(config)}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2.5 font-mono">
        <span>
          RX <span className="text-text-secondary">{formatBytes(rxBytes)}</span>
        </span>
        <span>
          TX <span className="text-text-secondary">{formatBytes(txBytes)}</span>
        </span>
      </div>
    </div>
  );
}
