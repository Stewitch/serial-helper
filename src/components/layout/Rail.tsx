import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { Settings } from "lucide-react";
import type { AppPage } from "@/stores/appStore";

const ICON = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;

const icons: Record<AppPage, JSX.Element> = {
  monitor: (
    <svg {...ICON} aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="11" rx="2" />
      <path d="M5.5 7.5l2 1.5-2 1.5M9.5 10.5h4M7 17h6" />
    </svg>
  ),
  flash: (
    <svg {...ICON} aria-hidden>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M8 2.5v3M12 2.5v3M8 14.5v3M12 14.5v3M2.5 8h3M2.5 12h3M14.5 8h3M14.5 12h3" />
    </svg>
  ),
  modules: (
    <svg {...ICON} aria-hidden>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  ),
  // Lucide's 24-unit gear; 1.8 stroke at 20px matches the 1.5 stroke of the other icons.
  settings: <Settings size={20} strokeWidth={1.8} aria-hidden />,
};

const LABEL_KEY: Record<AppPage, string> = {
  monitor: "monitor:title",
  flash: "flash:title",
  modules: "settings:moduleManagement",
  settings: "settings:title",
};

export function Rail({ active, onNavigate }: { active: AppPage; onNavigate: (page: AppPage) => void }) {
  const { t } = useTranslation();

  const item = (page: AppPage) => {
    const on = page === active;
    return (
      <button
        key={page}
        type="button"
        onClick={() => onNavigate(page)}
        aria-current={on ? "page" : undefined}
        title={t(LABEL_KEY[page])}
        aria-label={t(LABEL_KEY[page])}
        className={clsx(
          "relative w-10 h-10 grid place-items-center rounded-lg transition-colors",
          on ? "text-ink bg-raised" : "text-ink-3 hover:text-ink-2 hover:bg-raised/60"
        )}
      >
        {on && <span aria-hidden className="absolute -left-2 top-[11px] bottom-[11px] w-[3px] rounded-r-sm bg-accent" />}
        {icons[page]}
      </button>
    );
  };

  return (
    <nav className="flex flex-col items-center gap-1 py-2 bg-chrome border-r border-line">
      {item("monitor")}
      {item("flash")}
      {item("modules")}
      <span className="flex-1" />
      {item("settings")}
    </nav>
  );
}
