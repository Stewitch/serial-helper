import { create } from "zustand";
import type { PortInfo, SerialConfig } from "@/types/serial";

interface SerialStore {
  ports: PortInfo[];
  connectedPort: string | null;
  lostPortName: string | null;
  config: SerialConfig;
  isConnected: boolean;
  isWaitingReconnect: boolean;
  rxBytes: number;
  txBytes: number;
  isPaused: boolean;

  setPorts: (ports: PortInfo[]) => void;
  setConnected: (port: string | null) => void;
  setLostPort: (port: string | null) => void;
  setConfig: (config: Partial<SerialConfig>) => void;
  addRxBytes: (n: number) => void;
  addTxBytes: (n: number) => void;
  setPaused: (paused: boolean) => void;
  resetCounters: () => void;
}

export const useSerialStore = create<SerialStore>((set) => ({
  ports: [],
  connectedPort: null,
  lostPortName: null,
  config: {
    port_name: "",
    baud_rate: 115200,
    data_bits: "Eight",
    stop_bits: "One",
    parity: "None",
    flow_control: "None",
  },
  isConnected: false,
  isWaitingReconnect: false,
  rxBytes: 0,
  txBytes: 0,
  isPaused: false,

  setPorts: (ports) => set({ ports }),
  setConnected: (port) =>
    set({
      connectedPort: port,
      isConnected: port !== null,
      isWaitingReconnect: false,
      lostPortName: null,
    }),
  setLostPort: (port) =>
    set({
      lostPortName: port,
      connectedPort: null,
      isWaitingReconnect: port !== null,
      isConnected: false,
    }),
  setConfig: (partial) =>
    set((prev) => ({ config: { ...prev.config, ...partial } })),
  addRxBytes: (n) => set((prev) => ({ rxBytes: prev.rxBytes + n })),
  addTxBytes: (n) => set((prev) => ({ txBytes: prev.txBytes + n })),
  setPaused: (paused) => set({ isPaused: paused }),
  resetCounters: () => set({ rxBytes: 0, txBytes: 0 }),
}));
