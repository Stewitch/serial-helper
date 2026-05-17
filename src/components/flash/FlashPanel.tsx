import { useTranslation } from "react-i18next";

export function FlashPanel() {
  const { t } = useTranslation("flash");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide">
          {t("title")}
        </h2>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-flash/10 mb-4">
            <span className="text-2xl">⚡</span>
          </div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">
            {t("title")}
          </h3>
          <p className="text-[0.6875rem] text-text-secondary leading-relaxed mb-6">
            Flash firmware to STM32, Arduino, ESP32 and more.
            Supports HEX, BIN, SREC, ELF, and DFU formats.
          </p>

          <div className="grid grid-cols-2 gap-3 text-left">
            {[
              { icon: "🔌", label: "STM32 Serial ISP", desc: "UART bootloader" },
              { icon: "🔧", label: "ST-Link / SWD", desc: "STM32CubeProgrammer" },
              { icon: "🤖", label: "Arduino AVR", desc: "avrdude" },
              { icon: "💾", label: "DFU / USB", desc: "dfu-util" },
            ].map((item) => (
              <div
                key={item.label}
                className="p-2.5 rounded-lg border border-border bg-surface-alt/50 hover:bg-surface-hover transition-colors"
              >
                <div className="text-xs mb-0.5">{item.icon}</div>
                <div className="text-[0.625rem] font-medium text-text-primary">
                  {item.label}
                </div>
                <div className="text-[0.5625rem] text-text-muted">{item.desc}</div>
              </div>
            ))}
          </div>

          <p className="text-[0.625rem] text-accent mt-5 font-medium">
            Coming in Phase 2
          </p>
        </div>
      </div>
    </div>
  );
}
