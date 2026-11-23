import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { monitorBuffer, type MonitorLine } from "@/lib/monitorBuffer";
import { formatTimestamp } from "@/lib/formatTimestamp";

/** Distance from the bottom (px) within which the view keeps following new data. */
const FOLLOW_THRESHOLD = 24;
/** A pause at least this long is marked in the accent colour. */
const LONG_GAP_MS = 1000;

export interface MonitorOutputHandle {
  /** Moves to the next (dir = 1) or previous (dir = -1) search match. */
  stepMatch: (dir: 1 | -1) => void;
}

interface MonitorOutputProps {
  paused: boolean;
  autoScroll: boolean;
  timestampEnabled: boolean;
  timestampFormat: string;
  fontSize: number;
  query: string;
  onMatchesChange?: (info: { count: number; current: number }) => void;
  emptyState: ReactNode;
}

export const MonitorOutput = forwardRef<MonitorOutputHandle, MonitorOutputProps>(function MonitorOutput(
  { paused, autoScroll, timestampEnabled, timestampFormat, fontSize, query, onMatchesChange, emptyState },
  ref
) {
  const { t } = useTranslation("monitor");
  // The buffer mutates its array in place; `version` is what signals new data.
  const version = useSyncExternalStore(monitorBuffer.subscribe, monitorBuffer.getVersion);
  const live = monitorBuffer.getLines();

  // Pausing freezes the view; the buffer keeps receiving underneath.
  const [frozen, setFrozen] = useState<readonly MonitorLine[] | null>(null);
  useEffect(() => {
    setFrozen(paused ? monitorBuffer.getLines().slice() : null);
  }, [paused]);
  const lines = frozen ?? live;
  const lastId = (list: readonly MonitorLine[]) => (list.length > 0 ? list[list.length - 1].id : -1);
  const pendingNew = frozen ? Math.max(0, lastId(live) - lastId(frozen)) : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const rowHeight = Math.round(fontSize * 1.6);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (i) => lines[i].id,
    overscan: 30,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, timestampEnabled, virtualizer]);

  const scrollToEnd = useCallback(() => {
    if (lines.length === 0) return;
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [lines.length, virtualizer]);

  // Programmatic scrolls (ours, or the virtualizer correcting row heights)
  // must not count as the user leaving the bottom.
  const userInputAt = useRef(0);
  const markUserInput = useCallback(() => {
    userInputAt.current = performance.now();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD;
    const byUser = performance.now() - userInputAt.current < 400;
    if (bottom) followRef.current = true;
    else if (byUser) followRef.current = false;
    const following = bottom || followRef.current;
    setAtBottom(following);
    if (following) setUnseen(0);
  }, []);

  // Count lines that arrived while the user was reading history.
  const seenLastId = useRef(-1);
  useLayoutEffect(() => {
    const newest = lastId(lines);
    if (autoScroll && followRef.current) {
      scrollToEnd();
      seenLastId.current = newest;
    } else if (newest > seenLastId.current && seenLastId.current >= 0) {
      setUnseen(newest - seenLastId.current);
    } else if (seenLastId.current < 0) {
      seenLastId.current = newest;
    }
  }, [version, frozen, autoScroll, scrollToEnd, lines]);

  useEffect(() => {
    if (autoScroll) {
      followRef.current = true;
      scrollToEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScroll]);

  const jumpToLatest = () => {
    followRef.current = true;
    seenLastId.current = lastId(lines);
    setAtBottom(true);
    setUnseen(0);
    scrollToEnd();
  };

  /* ---------- Search ---------- */
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].text.toLowerCase().includes(needle)) out.push(i);
    }
    return out;
    // `version` invalidates when the live array grows in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, lines, version]);
  const [matchPos, setMatchPos] = useState(-1);
  const currentRow = matchPos >= 0 ? matches[matchPos] : -1;

  // A new query starts from the newest match.
  useEffect(() => {
    setMatchPos(matches.length > 0 ? matches.length - 1 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle]);

  useEffect(() => {
    if (matchPos >= matches.length) setMatchPos(matches.length - 1);
  }, [matches.length, matchPos]);

  useEffect(() => {
    onMatchesChange?.({ count: matches.length, current: matchPos + 1 });
  }, [matches.length, matchPos, onMatchesChange]);

  const goToMatch = useCallback(
    (pos: number) => {
      if (matches.length === 0) return;
      const wrapped = (pos + matches.length) % matches.length;
      setMatchPos(wrapped);
      followRef.current = false;
      setAtBottom(false);
      virtualizer.scrollToIndex(matches[wrapped], { align: "center" });
    },
    [matches, virtualizer]
  );

  useImperativeHandle(ref, () => ({ stepMatch: (dir) => goToMatch(matchPos + dir) }), [goToMatch, matchPos]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={markUserInput}
        onPointerDown={markUserInput}
        onKeyDown={markUserInput}
        tabIndex={0}
        aria-label={t("outputLabel")}
        className="flex-1 min-h-0 overflow-auto py-2 font-mono select-text focus-visible:outline-none"
        style={{ fontSize: `${fontSize}px`, lineHeight: `${rowHeight}px` }}
      >
        {lines.length === 0 ? (
          emptyState
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = lines[item.index];
              const prev = item.index > 0 ? lines[item.index - 1] : undefined;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <OutputLine
                    line={line}
                    gapMs={prev ? line.ts - prev.ts : null}
                    timestampEnabled={timestampEnabled}
                    timestampFormat={timestampFormat}
                    needle={needle}
                    current={item.index === currentRow}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!atBottom && lines.length > 0 && !paused && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute right-5 bottom-3 inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-accent text-accent-ink text-xs font-semibold shadow-pop hover:bg-accent-hover"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M6 1.5v8M2.5 6.5L6 10l3.5-3.5" />
          </svg>
          {unseen > 0 ? t("jumpToLatestCount", { count: unseen }) : t("jumpToLatest")}
        </button>
      )}

      {paused && (
        <div className="flex items-center justify-center h-7 border-t border-warn/30 bg-warn/10 text-xs text-warn">
          {pendingNew > 0 ? t("pausedWithNew", { count: pendingNew }) : t("pausedHint")}
        </div>
      )}
    </div>
  );
});

/* ---------- Line ---------- */

const LINE_TONE: Record<MonitorLine["type"], string> = {
  rx: "text-rx",
  tx: "text-tx",
  system: "text-ink-3 font-sans",
  warn: "text-warn",
  error: "text-err",
};

function formatGap(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Groove length grows with the log of the gap: 1 ms ≈ 2 px, 1 s ≈ 30 px, 10 s+ = 36 px. */
function gapWidth(ms: number): number {
  if (ms <= 1) return 2;
  return Math.min(36, Math.max(2, Math.round(Math.log10(ms) * 10)));
}

const OutputLine = memo(function OutputLine({
  line,
  gapMs,
  timestampEnabled,
  timestampFormat,
  needle,
  current,
}: {
  line: MonitorLine;
  gapMs: number | null;
  timestampEnabled: boolean;
  timestampFormat: string;
  needle: string;
  current: boolean;
}) {
  const long = gapMs !== null && gapMs >= LONG_GAP_MS;
  return (
    <div
      className={clsx(
        "group grid pr-4",
        timestampEnabled ? "grid-cols-[64px_auto_1fr]" : "grid-cols-[64px_1fr]",
        current ? "bg-accent/15" : "hover:bg-raised/60"
      )}
    >
      <span className={clsx("relative flex items-center justify-end pr-2.5 text-2xs select-none", long ? "text-accent" : "text-ink-3")}>
        {gapMs !== null && (
          <>
            <i
              aria-hidden
              className={clsx(
                "absolute left-2.5 top-1/2 h-0.5 -translate-y-1/2 rounded-[1px] bg-line-strong",
                // The groove and the number share the cell: whenever the number shows, the groove hides.
                long ? "hidden" : "group-hover:invisible"
              )}
              style={{ width: gapWidth(gapMs) }}
            />
            <em className={clsx("not-italic", long ? "visible" : "invisible group-hover:visible")}>{formatGap(gapMs)}</em>
          </>
        )}
      </span>
      {timestampEnabled && (
        <span className="pr-3 text-ink-3 select-none">{formatTimestamp(line.ts, timestampFormat)}</span>
      )}
      <span className={clsx("whitespace-pre-wrap break-all min-w-0", LINE_TONE[line.type])}>
        {line.type === "tx" && <span className="text-ink-3 select-none">› </span>}
        <Highlighted text={line.text} needle={needle} />
      </span>
    </div>
  );
});

function Highlighted({ text, needle }: { text: string; needle: string }) {
  // Zero-width space keeps empty lines one row tall.
  if (!text) return <>{"​"}</>;
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-accent/35 text-inherit rounded-sm">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
