import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useSettingsStore } from "@/stores/settingsStore";
import { encodeText } from "@/lib/textCodec";
import { Button, Kbd, Segmented } from "@/components/ui";

const MAX_HISTORY = 100;
const ENDINGS = { CRLF: "\r\n", LF: "\n", CR: "\r", NONE: "" } as const;
type Ending = keyof typeof ENDINGS;

interface SendInputProps {
  /** `display` is what the monitor log shows for this send. */
  onSend: (data: number[], display: string) => void;
  disabled?: boolean;
}

function parseHex(text: string): number[] | null {
  const cleaned = text.replace(/0x/gi, "").replace(/[\s,]/g, "");
  if (!cleaned || cleaned.length % 2 !== 0 || /[^0-9a-f]/i.test(cleaned)) return null;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) out.push(parseInt(cleaned.slice(i, i + 2), 16));
  return out;
}

const toHex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

export function SendInput({ onSend, disabled }: SendInputProps) {
  const { t } = useTranslation("monitor");
  const lineEnding = useSettingsStore((s) => s.lineEnding) as Ending;
  const setLineEnding = useSettingsStore((s) => s.setLineEnding);
  const encoding = useSettingsStore((s) => s.encoding);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "hex">("text");
  const [history, setHistory] = useState<string[]>([]);
  const historyIdx = useRef(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const hexBytes = useMemo(() => (mode === "hex" && text.trim() ? parseHex(text) : null), [mode, text]);
  const hexInvalid = mode === "hex" && text.trim().length > 0 && hexBytes === null;
  const canSend = !disabled && (mode === "hex" ? hexBytes !== null : text.length > 0);

  const doSend = useCallback(() => {
    if (!canSend) return;
    let data: number[];
    let display: string;
    if (mode === "hex") {
      data = hexBytes!;
      display = toHex(data);
    } else {
      data = encodeText(text + ENDINGS[lineEnding], encoding);
      display = text;
    }
    onSend(data, display);
    setHistory((prev) => [text, ...prev.filter((h) => h !== text)].slice(0, MAX_HISTORY));
    historyIdx.current = -1;
    if (mode === "text") setText("");
  }, [canSend, mode, hexBytes, text, lineEnding, encoding, onSend]);

  const recall = (dir: 1 | -1) => {
    const next = Math.max(-1, Math.min(history.length - 1, historyIdx.current + dir));
    historyIdx.current = next;
    setText(next >= 0 ? history[next] : "");
  };

  return (
    <div className="border-t border-line px-3 py-2.5 shrink-0">
      <div className="flex items-center gap-2">
        <Segmented
          aria-label={t("sendMode")}
          value={mode}
          onChange={setMode}
          mono={false}
          options={[
            { value: "text", label: t("modeText") },
            { value: "hex", label: "HEX" },
          ]}
        />
        <div
          className={clsx(
            "flex-1 flex items-center gap-2 h-[34px] px-3 rounded-md bg-raised border",
            hexInvalid ? "border-err" : "border-line-strong focus-within:border-accent",
            disabled && "opacity-50"
          )}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              historyIdx.current = -1;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doSend();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                recall(1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                recall(-1);
              }
            }}
            disabled={disabled}
            placeholder={disabled ? t("sendDisabledHint") : mode === "hex" ? "AA 55 01 FF" : t("inputPlaceholder")}
            aria-label={t("send")}
            aria-invalid={hexInvalid}
            className="flex-1 min-w-0 bg-transparent font-mono text-sm text-ink placeholder:text-ink-3 placeholder:font-sans focus:outline-none"
          />
          <span className="flex items-center gap-1.5 text-xs text-ink-3 shrink-0">
            {hexInvalid ? (
              <span className="text-err">{t("hexInvalid")}</span>
            ) : hexBytes ? (
              <span className="font-mono">{t("byteCount", { count: hexBytes.length })}</span>
            ) : (
              !disabled && (
                <>
                  <Kbd>↑</Kbd> {t("sendHistory")}
                </>
              )
            )}
          </span>
        </div>
        <Segmented
          aria-label={t("common:lineEnding")}
          value={lineEnding}
          onChange={setLineEnding}
          disabled={mode === "hex"}
          options={[
            { value: "CRLF", label: "CRLF", title: "\\r\\n" },
            { value: "LF", label: "LF", title: "\\n" },
            { value: "CR", label: "CR", title: "\\r" },
            { value: "NONE", label: t("endingNone") },
          ]}
        />
        <Button variant="primary" size="md" onClick={doSend} disabled={!canSend}>
          {t("send")}
        </Button>
      </div>
    </div>
  );
}
