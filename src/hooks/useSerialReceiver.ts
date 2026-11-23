import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { useSerialStore } from "@/stores/serialStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { monitorBuffer } from "@/lib/monitorBuffer";

const POLL_INTERVAL_MS = 20;
/** Matches the read size cap in SerialManager::read_available. */
const BACKEND_READ_CAP = 8192;

/**
 * Drains the open port into the monitor buffer. Mount once at the app root so
 * reception continues on every page and while the monitor view is paused.
 */
export function useSerialReceiver() {
  const appState = useAppStore((s) => s.appState);
  const encoding = useSettingsStore((s) => s.encoding);
  const maxLines = useSettingsStore((s) => s.monitorMaxLines);

  useEffect(() => {
    monitorBuffer.setEncoding(encoding);
  }, [encoding]);

  useEffect(() => {
    monitorBuffer.setMaxLines(maxLines);
  }, [maxLines]);

  useEffect(() => {
    if (appState !== "MONITORING") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Self-scheduling loop: never more than one read in flight.
    const poll = async () => {
      let delay = POLL_INTERVAL_MS;
      try {
        const data = await invoke<number[]>("read_data");
        if (!stopped && data.length > 0) {
          useSerialStore.getState().addRxBytes(data.length);
          monitorBuffer.appendRx(Uint8Array.from(data));
          // A full read likely means more is waiting.
          if (data.length >= BACKEND_READ_CAP) delay = 0;
        }
      } catch {
        // Port may have gone away; the port scanner handles that state.
      }
      if (!stopped) timer = setTimeout(poll, delay);
    };
    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      monitorBuffer.resetDecoder();
    };
  }, [appState]);
}
