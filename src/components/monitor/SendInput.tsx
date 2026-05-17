import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { Send, Hash } from "lucide-react";
import clsx from "clsx";

interface SendInputProps {
  onSend: (data: number[]) => void;
  disabled?: boolean;
}

const MAX_HISTORY = 100;

export function SendInput({ onSend, disabled }: SendInputProps) {
  const { t } = useTranslation("monitor");
  const lineEnding = useSettingsStore((s) => s.lineEnding);
  const [text, setText] = useState("");
  const [hexMode, setHexMode] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [_historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const getLineEnding = useCallback(() => {
    switch (lineEnding) {
      case "CRLF": return "\r\n";
      case "LF": return "\n";
      case "CR": return "\r";
    }
  }, [lineEnding]);

  const parsedHexPreview = (() => {
    if (!hexMode || !text.trim()) return null;
    const cleaned = text.replace(/\s/g, "");
    if (cleaned.length % 2 !== 0) return { valid: false, bytes: [] as number[] };
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      const b = parseInt(cleaned.slice(i, i + 2), 16);
      if (isNaN(b)) return { valid: false, bytes: [] as number[] };
      bytes.push(b);
    }
    return { valid: true, bytes };
  })();

  const doSend = useCallback(() => {
    let data: number[];
    if (hexMode) {
      if (!parsedHexPreview?.valid) return;
      data = parsedHexPreview.bytes;
    } else {
      const encoder = new TextEncoder();
      const ending = getLineEnding();
      data = Array.from(encoder.encode(text + ending));
    }

    if (data.length > 0) {
      onSend(data);
      setHistory((prev) => {
        const next = [text, ...prev.filter((h) => h !== text)].slice(0, MAX_HISTORY);
        return next;
      });
      setHistoryIdx(-1);
      if (!hexMode) setText("");
    }
  }, [text, hexMode, getLineEnding, onSend, parsedHexPreview]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHistoryIdx((prev) => {
          const next = Math.min(prev + 1, history.length - 1);
          if (next >= 0 && history[next] != null) setText(history[next]);
          return next;
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHistoryIdx((prev) => {
          const next = Math.max(prev - 1, -1);
          setText(next >= 0 ? history[next] || "" : "");
          return next;
        });
      } else if (e.key === "Escape") {
        inputRef.current?.blur();
      }
    },
    [doSend, history]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const canSend = hexMode
    ? parsedHexPreview?.valid === true
    : text.trim().length > 0;

  return (
    <div className="flex flex-col border-t border-border bg-surface-alt/50">
      {/* Hex preview */}
      {hexMode && text.trim() && (
        <div className="px-3 py-1 border-b border-border bg-surface font-mono text-[0.6875rem] flex items-center gap-2">
          <span className="text-text-muted shrink-0">HEX:</span>
          {parsedHexPreview?.valid ? (
            <span className="text-monitor-tx">
              {parsedHexPreview.bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ")}
              <span className="text-text-muted ml-2">
                ({parsedHexPreview.bytes.length} bytes)
              </span>
            </span>
          ) : (
            <span className="text-flash-error">Invalid hex input</span>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[0.625rem] text-text-muted font-medium shrink-0">
          {t("send")}
        </span>

        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={hexMode ? "00 FF A5 ..." : (t("inputPlaceholder") || "")}
            className="w-full h-7 px-2.5 text-xs bg-surface border border-border rounded font-mono text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent disabled:opacity-40 transition-colors"
          />
        </div>

        <button
          onClick={() => setHexMode(!hexMode)}
          className={clsx(
            "h-7 px-2 text-[0.625rem] font-medium rounded border transition-colors shrink-0 flex items-center gap-1",
            hexMode
              ? "bg-accent text-white border-accent"
              : "bg-surface border-border text-text-muted hover:text-text-secondary hover:border-border-strong"
          )}
        >
          <Hash size={11} />
          HEX
        </button>

        <button
          onClick={doSend}
          disabled={disabled || !canSend}
          className="h-7 px-3 text-xs font-medium bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 flex items-center gap-1"
        >
          <Send size={11} />
          {t("send")}
        </button>
      </div>
    </div>
  );
}
