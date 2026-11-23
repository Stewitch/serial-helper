import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { formatSize, hex32, type FlashGeometry } from "./flashModel";

interface PageMapProps {
  geometry: FlashGeometry;
  /** Firmware bytes per cell; null when no firmware is loaded. */
  firmware: number[] | null;
  written: number[];
  activeCell: number;
}

/**
 * The chip's flash drawn one cell per page. Cells the firmware covers fill in
 * as they are written; the cell being written or verified right now pulses.
 */
export const PageMap = memo(function PageMap({ geometry, firmware, written, activeCell }: PageMapProps) {
  const { t } = useTranslation("flash");
  const cols = Math.min(32, geometry.cells);

  return (
    <div>
      <div
        role="img"
        aria-label={t("mapLabel", { size: formatSize(geometry.size) })}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: geometry.cells }, (_, i) => {
          const fw = firmware?.[i] ?? 0;
          const done = fw > 0 && (written[i] ?? 0) >= fw;
          const active = i === activeCell;
          const start = geometry.start + i * geometry.cellBytes;
          return (
            <i
              key={i}
              title={`${hex32(start)} – ${hex32(start + geometry.cellBytes - 1)}`}
              className={clsx(
                "aspect-[1.6] rounded-[2px]",
                active
                  ? "bg-accent/45 shadow-[inset_0_0_0_1px_rgb(var(--accent))] animate-[page-pulse_0.9s_ease-in-out_infinite_alternate]"
                  : done
                    ? "bg-accent"
                    : fw > 0
                      ? "shadow-[inset_0_0_0_1px_rgb(var(--line-strong))]"
                      : "shadow-[inset_0_0_0_1px_rgb(var(--line))]"
              )}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1 mt-2 text-xs text-ink-3">
        <Legend swatch="bg-accent">{t("legendWritten")}</Legend>
        <Legend swatch="shadow-[inset_0_0_0_1px_rgb(var(--line-strong))]">{t("legendPending")}</Legend>
        <Legend swatch="shadow-[inset_0_0_0_1px_rgb(var(--line))]">{t("legendUnused")}</Legend>
        <span className="ml-auto font-mono">
          {hex32(geometry.start)} – {hex32(geometry.start + geometry.size - 1)}
          <span className="font-sans">　{t("cellSize", { size: formatSize(geometry.cellBytes) })}</span>
        </span>
      </div>
    </div>
  );
});

function Legend({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={clsx("w-3 h-2 rounded-[2px]", swatch)} />
      {children}
    </span>
  );
}
