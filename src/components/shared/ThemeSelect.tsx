import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ThemeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  side?: "top" | "bottom";
}

export function ThemeSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
  side = "bottom",
}: ThemeSelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={clsx(
          "inline-flex items-center justify-between gap-1 h-7 px-2 text-[0.6875rem]",
          "bg-surface border border-border rounded",
          "text-text-primary cursor-pointer",
          "focus:outline-none focus:border-accent",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "min-w-0 font-mono",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown size={10} className="text-text-muted shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          side={side}
          sideOffset={4}
          className={clsx(
            "z-50 overflow-hidden rounded-md",
            "bg-surface border border-border",
            "shadow-lg shadow-black/10 dark:shadow-black/30",
            "animate-in fade-in-0 zoom-in-95 duration-150"
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={clsx(
                  "relative flex items-center px-2 py-1.5 text-[0.6875rem] rounded-sm cursor-pointer",
                  "text-text-primary font-mono",
                  "data-[disabled]:text-text-muted data-[disabled]:cursor-not-allowed",
                  "data-[state=checked]:bg-accent/10 data-[state=checked]:text-accent",
                  "data-[highlighted]:bg-accent data-[highlighted]:!text-white",
                  "outline-none select-none"
                )}
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
