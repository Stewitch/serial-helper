import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { BrandMark } from "./BrandMark";

const inTauri = isTauri();

/** Window chrome only: app mark, name, drag area and window buttons. */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (inTauri && e.target === e.currentTarget) void getCurrentWindow().toggleMaximize();
      }}
      className="col-span-2 flex items-center h-9 bg-chrome border-b border-line select-none"
    >
      <div data-tauri-drag-region className="w-14 self-stretch grid place-items-center shrink-0">
        <BrandMark size={18} />
      </div>
      <span data-tauri-drag-region className="text-sm font-semibold text-ink-2">
        Serial Helper
      </span>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {inTauri && <WindowControls />}
    </header>
  );
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
