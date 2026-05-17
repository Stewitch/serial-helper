import { ThemeSelect } from "./ThemeSelect";
import type { SelectOption } from "./ThemeSelect";
import { BAUD_RATES } from "@/types/serial";

interface BaudRateInputProps {
  value: number;
  onChange: (baud: number) => void;
  disabled?: boolean;
}

export function BaudRateInput({
  value,
  onChange,
  disabled,
}: BaudRateInputProps) {
  const options: SelectOption[] = BAUD_RATES.map((rate) => ({
    value: String(rate),
    label: String(rate),
  }));

  return (
    <ThemeSelect
      value={String(value)}
      onChange={(v) => onChange(parseInt(v))}
      options={options}
      disabled={disabled}
      placeholder="Baud"
    />
  );
}
