import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { PortInfo, SerialConfig } from "@/types/serial";

const SCAN_INTERVAL_MS = 2000;

export function usePortScanner() {
  const setPorts = useSerialStore((s) => s.setPorts);
  const setLostPort = useSerialStore((s) => s.setLostPort);
  const setConnected = useSerialStore((s) => s.setConnected);
  const setState = useAppStore((s) => s.setState);
  const autoReconnect = useSettingsStore((s) => s.autoReconnect);

  const prevPortsRef = useRef<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a ref of the port that was active, so after setLostPort clears connectedPort,
  // we still know which port we were tracking for reconnection.
  const trackingRef = useRef<string | null>(null);

  const scan = useCallback(async () => {
    try {
      const ports = await invoke<PortInfo[]>("list_ports");
      const currentNames = ports.map((p) => p.name);

      const currentConnected = useSerialStore.getState().connectedPort;
      const currentLost = useSerialStore.getState().lostPortName;

      // If monitoring and port disappeared — close Rust port FIRST
      if (currentConnected && !currentNames.includes(currentConnected)) {
        trackingRef.current = currentConnected;
        // Release the Rust-side port handle before updating frontend state
        try { await invoke("close_port"); } catch { /* port may already be gone */ }
        setLostPort(currentConnected);
        setState("PORT_LOST");
        setPorts(ports);
        prevPortsRef.current = currentNames;
        return;
      }

      // If waiting for reconnect and port reappeared
      if (currentLost && currentNames.includes(currentLost)) {
        if (autoReconnect) {
          const cfg: SerialConfig = {
            ...useSerialStore.getState().config,
            port_name: currentLost,
          };
          try {
            await invoke("open_port", { config: cfg });
            setConnected(currentLost);
            setState("MONITORING");
            trackingRef.current = null;
          } catch {
            // Reconnect failed — clear lost state, go to IDLE
            setConnected(null);
            setState("IDLE");
            trackingRef.current = null;
          }
        } else {
          // Not auto-reconnecting — clear lost state, let user connect manually
          setConnected(null);
          setState("IDLE");
          trackingRef.current = null;
        }
      }

      setPorts(ports);
      prevPortsRef.current = currentNames;
    } catch {
      // Silently handle scan errors
    }
  }, [autoReconnect, setPorts, setLostPort, setConnected, setState]);

  // Start polling
  useEffect(() => {
    scan();
    intervalRef.current = setInterval(scan, SCAN_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scan]);
}
