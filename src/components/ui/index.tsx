// Shared controls. Every page builds from these so sizes, radii and states stay
// consistent across the app.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import clsx from "clsx";

/* ---------------- Button ---------------- */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows the pressed look for toggle buttons. */
  pressed?: boolean;
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink font-semibold hover:bg-accent-hover",
  outline: "border border-line-strong text-ink font-semibold hover:bg-raised",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised",
  danger: "border border-err/45 text-err font-semibold hover:bg-err/10",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-[30px] px-2.5 gap-1.5 text-sm rounded",
  md: "h-[34px] px-3.5 gap-1.5 text-sm rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "sm", icon, pressed, className, children, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={clsx(
        "inline-flex items-center justify-center shrink-0 whitespace-nowrap transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none",
        BUTTON_SIZE[size],
        BUTTON_VARIANT[variant],
        pressed && "!text-ink bg-raised shadow-[inset_0_0_0_1px_rgb(var(--line))]",
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

/* ---------------- Select ---------------- */

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Secondary text shown after the label, e.g. a USB product name. */
  hint?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mono?: boolean;
  "aria-label"?: string;
  size?: "sm" | "md";
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  mono,
  size = "md",
  ...rest
}: SelectProps) {
  const current = options.find((o) => o.value === value);
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={rest["aria-label"]}
        className={clsx(
          "inline-flex items-center gap-2 min-w-0 px-2.5 rounded border border-line bg-base text-ink",
          "hover:border-line-strong data-[state=open]:border-accent",
          "disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:border-accent",
          size === "md" ? "h-[30px] text-sm" : "h-7 text-xs",
          mono && "font-mono",
          className
        )}
      >
        <span className="truncate">
          {current ? current.label : <span className="text-ink-3">{placeholder}</span>}
        </span>
        {current?.hint && <span className="truncate font-sans text-xs text-ink-3">{current.hint}</span>}
        <SelectPrimitive.Icon className="ml-auto text-ink-3">
          <ChevronDown size={13} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] max-h-[min(360px,var(--radix-select-content-available-height))] overflow-hidden rounded-lg bg-raised shadow-pop"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={clsx(
                  "relative flex items-center gap-2 h-8 pl-7 pr-3 rounded text-sm text-ink cursor-default select-none outline-none",
                  "data-[highlighted]:bg-accent/15 data-[disabled]:text-ink-3",
                  mono && "font-mono"
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 text-accent">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                {opt.hint && <span className="ml-auto pl-4 font-sans text-xs text-ink-3">{opt.hint}</span>}
              </SelectPrimitive.Item>
            ))}
            {options.length === 0 && (
              <div className="px-3 py-2 text-sm text-ink-3">{placeholder}</div>
            )}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ---------------- Segmented control ---------------- */

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  mono?: boolean;
  disabled?: boolean;
  "aria-label": string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  mono = true,
  disabled,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={clsx(
        "inline-flex p-0.5 rounded-md bg-chrome border border-line shrink-0",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "h-6 px-2.5 rounded-[5px] text-xs transition-colors",
              mono && "font-mono",
              on ? "bg-raised text-ink shadow-[0_0_0_1px_rgb(var(--line))]" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Switch ---------------- */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

export function Switch({ checked, onChange, disabled, id, ...rest }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative w-[30px] h-4 rounded-full shrink-0 transition-colors disabled:opacity-40",
        checked ? "bg-accent" : "bg-line-strong"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform",
          checked ? "translate-x-[14px] bg-accent-ink" : "bg-ink"
        )}
      />
    </button>
  );
}

/* ---------------- Layout helpers ---------------- */

export function ToolbarSep() {
  return <span aria-hidden className="w-px h-[18px] bg-line mx-1.5 shrink-0" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="px-1.5 py-px rounded border border-line-strong font-mono text-2xs text-ink-3">
      {children}
    </kbd>
  );
}

/** One labelled row in a settings-style list: label (and optional hint) on the left, control on the right. */
export function FieldRow({
  label,
  hint,
  htmlFor,
  children,
  indent,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  indent?: boolean;
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-4 min-h-[34px] py-1", indent && "pl-5")}>
      <label htmlFor={htmlFor} className="min-w-0">
        <span className="block text-sm text-ink-2">{label}</span>
        {hint && <span className="block text-xs text-ink-3 mt-0.5">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function FieldGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold text-ink-3">{title}</h3>
      {children}
    </section>
  );
}
