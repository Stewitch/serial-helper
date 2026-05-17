import { useTranslation } from "react-i18next";
import { useSerialStore } from "@/stores/serialStore";
import { ThemeSelect } from "./ThemeSelect";
import type { SelectOption } from "./ThemeSelect";
import clsx from "clsx";
import type { PortInfo } from "@/types/serial";

interface PortSelectorProps {
  value: string;
  onChange: (port: string) => void;
  disabled?: boolean;
  portLost?: boolean;
}

// Extract numeric part from COM port name for sorting
function portSortKey(name: string): number {
  const match = name.match(/COM(\d+)/i);
  if (match) return parseInt(match[1]);
  // Non-COM ports sort after, alphabetically by name hash
  return 100000 + name.charCodeAt(0);
}

export function PortSelector({
  value,
  onChange,
  disabled,
  portLost,
}: PortSelectorProps) {
  const { t } = useTranslation("common");
  const ports = useSerialStore((s) => s.ports);
  const connectedPort = useSerialStore((s) => s.connectedPort);

  const showLostOption = portLost && value && !ports.some((p) => p.name === value);

  // Sort ports: COM ports by number ascending, then others alphabetically
  const sorted = [...ports].sort((a, b) => portSortKey(a.name) - portSortKey(b.name));

  const options: SelectOption[] = [
    ...(showLostOption ? [{ value, label: `${value} — ${t("disconnect", { ns: "common" })}` }] : []),
    ...sorted.map((p: PortInfo) => ({
      value: p.name,
      label: p.productName ? `${p.name} — ${p.productName}` : p.name,
    })),
  ];

  return (
    <div className="relative">
      <ThemeSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        placeholder={t("port") + "..."}
        className={clsx(
          "min-w-[160px]",
          portLost && "border-yellow-500/50"
        )}
      />
      {connectedPort && value === connectedPort && !portLost && (
        <span className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-green-500 border border-surface z-10" />
      )}
      {portLost && (
        <span className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-yellow-500 border border-surface animate-pulse z-10" />
      )}
    </div>
  );
}
