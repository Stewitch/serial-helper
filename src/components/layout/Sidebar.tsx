import { useTranslation } from "react-i18next";
import { useSerialStore } from "@/stores/serialStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { AppPage } from "@/stores/appStore";
import { usePortScanner } from "@/hooks/usePortScanner";
import { Plug, Zap, Settings, Monitor, ArrowRightLeft, WifiOff, Boxes } from "lucide-react";
import clsx from "clsx";
import type { PortInfo } from "@/types/serial";

interface SidebarProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
}

const navItems: { id: AppPage; Icon: typeof Monitor; labelKey: string }[] = [
  { id: "monitor", Icon: Monitor, labelKey: "monitor:title" },
  { id: "flash", Icon: Zap, labelKey: "flash:title" },
  { id: "modules", Icon: Boxes, labelKey: "settings:moduleManagement" },
  { id: "settings", Icon: Settings, labelKey: "settings:title" },
];

function portSortKey(name: string): number {
  const match = name.match(/COM(\d+)/i);
  if (match) return parseInt(match[1]);
  return 100000 + name.charCodeAt(0);
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const ports = useSerialStore((s) => s.ports);
  const connectedPort = useSerialStore((s) => s.connectedPort);
  const lostPortName = useSerialStore((s) => s.lostPortName);
  const setConfig = useSerialStore((s) => s.setConfig);
  const isConnected = useSerialStore((s) => s.isConnected);
  const autoReconnect = useSettingsStore((s) => s.autoReconnect);
  const setAutoReconnect = useSettingsStore((s) => s.setAutoReconnect);
  usePortScanner();

  // Merge real ports with virtual lost port, sorted by COM number
  const displayPorts = (() => {
    const result = [...ports].sort((a, b) => portSortKey(a.name) - portSortKey(b.name));
    if (lostPortName && !ports.some((p) => p.name === lostPortName)) {
      result.unshift({
        name: lostPortName,
        description: `${lostPortName} (${t("monitor:portLost")})`,
        vid: 0,
        pid: 0,
        serialNumber: null,
        manufacturer: null,
        productName: null,
      });
    }
    return result;
  })();

  const handlePortClick = (portName: string) => {
    if (!isConnected) {
      setConfig({ port_name: portName });
    }
  };

  return (
    <aside className="w-52 flex flex-col bg-surface-alt border-r border-border theme-transition text-xs overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
        <Plug size={13} className="text-accent shrink-0" />
        <span className="text-[0.6875rem] font-semibold tracking-wide text-text-muted uppercase">
          {t("common:appTitle")}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col py-1 border-b border-border">
        {navItems.map(({ id, Icon, labelKey }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={clsx(
              "flex items-center gap-2.5 px-3 h-8 text-left transition-colors",
              activePage === id
                ? "bg-surface text-accent font-medium border-r-[2px] border-r-accent"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            )}
          >
            <Icon size={14} className="shrink-0" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </nav>

      {/* Port List */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[0.625rem] font-semibold tracking-wide text-text-muted uppercase">
            {t("common:port")}
          </span>
          <span className="text-[0.625rem] text-text-muted tabular-nums">
            {ports.length > 0 ? ports.length : "—"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {displayPorts.length === 0 ? (
            <p className="px-1 py-4 text-center text-text-muted text-[0.6875rem] leading-relaxed">
              {t("monitor:noPortsFound")}
            </p>
          ) : (
            displayPorts.map((p: PortInfo) => {
              const isActive = connectedPort === p.name || lostPortName === p.name;
              const isLost = !ports.some((rp) => rp.name === p.name);
              const portState = isLost ? "lost" : isActive ? "active" : "idle";
              return (
                <button
                  key={p.name}
                  onClick={() => handlePortClick(p.name)}
                  disabled={isConnected}
                  className={clsx(
                    "w-full px-2 py-1.5 rounded mb-0.5 text-left transition-colors",
                    isActive && portState === "active"
                      ? "bg-accent/10 border border-accent/30"
                      : isLost
                        ? "bg-yellow-500/10 border border-yellow-500/30"
                        : "hover:bg-surface-hover border border-transparent",
                    !isConnected && "cursor-pointer"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={clsx(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        portState === "active"
                          ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]"
                          : portState === "lost"
                            ? "bg-yellow-500 animate-pulse"
                            : "bg-text-muted"
                      )}
                    />
                    <span
                      className={clsx(
                        "truncate font-mono text-[0.6875rem]",
                        isActive ? "text-text-primary font-medium" : "text-text-secondary"
                      )}
                    >
                      {p.name}
                    </span>
                    {isLost && (
                      <WifiOff size={10} className="text-yellow-500 shrink-0 ml-auto" />
                    )}
                  </div>
                  {p.productName && !isLost && (
                    <p className="mt-0.5 ml-[18px] text-[0.625rem] text-text-muted truncate">
                      {p.productName}
                    </p>
                  )}
                  {isLost && (
                    <p className="mt-0.5 ml-[18px] text-[0.625rem] text-yellow-600 dark:text-yellow-400">
                      {t("monitor:portLost")}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border-t border-border px-2.5 py-2 space-y-1">
        <button
          onClick={() => setAutoReconnect(!autoReconnect)}
          className={clsx(
            "flex items-center gap-2 w-full px-2 py-1.5 rounded text-[0.6875rem] transition-colors",
            autoReconnect
              ? "text-accent bg-accent/5"
              : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
          )}
        >
          {autoReconnect ? (
            <ArrowRightLeft size={12} className="shrink-0" />
          ) : (
            <ArrowRightLeft size={12} className="shrink-0 opacity-50" />
          )}
          {t("monitor:autoReconnect")}
        </button>
      </div>
    </aside>
  );
}
