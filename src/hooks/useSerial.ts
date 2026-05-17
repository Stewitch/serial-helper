import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import type { SerialConfig } from "@/types/serial";

const POLL_INTERVAL_MS = 30;

function extractError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    return JSON.stringify(e);
  }
  return String(e);
}

// Humanize Rust error variant names like "PortNotOpen" → "Port is not open"
function humanizeError(raw: string): string {
  // Already a readable sentence
  if (raw.includes(" ")) return raw;
  // Try to split PascalCase
  const split = raw.replace(/([A-Z])/g, " $1").trim();
  if (split.includes(" ")) return split;
  return raw;
}

export function useSerial(
  onData?: (data: number[], timestamp: number) => void,
  onError?: (error: string) => void
) {
  const isPaused = useSerialStore((s) => s.isPaused);
  const addRxBytes = useSerialStore((s) => s.addRxBytes);
  const addTxBytes = useSerialStore((s) => s.addTxBytes);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(
    async (config: SerialConfig): Promise<string | null> => {
      try {
        await invoke("open_port", { config });
        useSerialStore.getState().setConnected(config.port_name);
        setState("MONITORING");
        return null;
      } catch (e) {
        const msg = humanizeError(extractError(e));
        onError?.(msg);
        return msg;
      }
    },
    [setState, onError]
  );

  const disconnect = useCallback(async () => {
    try {
      await invoke("close_port");
      useSerialStore.getState().setConnected(null);
      setState("IDLE");
    } catch (e) {
      onError?.(humanizeError(extractError(e)));
    }
  }, [setState, onError]);

  const send = useCallback(
    async (data: number[]) => {
      try {
        const written = await invoke<number>("write_data", { data });
        addTxBytes(written);
      } catch (e) {
        onError?.(humanizeError(extractError(e)));
      }
    },
    [addTxBytes, onError]
  );

  // Poll for incoming data
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (appState === "MONITORING" && !isPaused) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await invoke<number[]>("read_data");
          if (data.length > 0) {
            addRxBytes(data.length);
            onData?.(data, Date.now());
          }
        } catch {
          // Port may have been disconnected; errors handled by scanner
        }
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [appState, isPaused, addRxBytes, onData]);

  // NO cleanup on unmount — serial connection persists across page switches.
  // The port is only closed by explicit user action (click Disconnect).

  return { connect, disconnect, send };
}
