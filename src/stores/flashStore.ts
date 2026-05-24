import { create } from "zustand";

export interface FirmwareInfo {
  filename: string;
  format: string;
  size: number;
  segments: { address: number; size: number; range: string }[];
  checksum: string;
}

interface FlashStoreState {
  flashModule: string;
  firmwarePath: string;
  firmware: FirmwareInfo | null;
  verify: boolean;
  runAfter: boolean;
  dtrRtsEnabled: boolean;
  rtsFunc: string;
  rtsLevel: string;
  dtrFunc: string;
  dtrLevel: string;
  flashReadAddress: string;
  flashReadSize: string;
  avrProgrammer: string;
  avrChip: string;
}

interface FlashStore extends FlashStoreState {
  setFlashModule: (module: string) => void;
  setFirmwareSelection: (firmwarePath: string, firmware: FirmwareInfo | null) => void;
  setVerify: (verify: boolean) => void;
  setRunAfter: (runAfter: boolean) => void;
  setDtrRtsEnabled: (enabled: boolean) => void;
  setRtsFunc: (value: string) => void;
  setRtsLevel: (value: string) => void;
  setDtrFunc: (value: string) => void;
  setDtrLevel: (value: string) => void;
  setFlashReadAddress: (value: string) => void;
  setFlashReadSize: (value: string) => void;
  setAvrProgrammer: (value: string) => void;
  setAvrChip: (value: string) => void;
  clearFirmware: () => void;
  persist: () => void;
}

function loadFlashState(): Partial<FlashStoreState> {
  try {
    const raw = localStorage.getItem("serialhelper-flash");
    if (raw) return JSON.parse(raw) as Partial<FlashStoreState>;
  } catch {
    // ignore
  }
  return {};
}

const saved = loadFlashState();

export const useFlashStore = create<FlashStore>((set, get) => ({
  flashModule: saved.flashModule || "stm32-isp",
  firmwarePath: saved.firmwarePath || "",
  firmware: saved.firmware || null,
  verify: saved.verify ?? true,
  runAfter: saved.runAfter ?? true,
  dtrRtsEnabled: saved.dtrRtsEnabled ?? true,
  rtsFunc: saved.rtsFunc || "reset",
  rtsLevel: saved.rtsLevel || "low",
  dtrFunc: saved.dtrFunc || "bootloader",
  dtrLevel: saved.dtrLevel || "high",
  flashReadAddress: saved.flashReadAddress || "0x08000000",
  flashReadSize: saved.flashReadSize || "0x20000",
  avrProgrammer: saved.avrProgrammer || "arduino",
  avrChip: saved.avrChip || "m328p",

  setFlashModule: (flashModule) => {
    set({ flashModule });
    get().persist();
  },
  setFirmwareSelection: (firmwarePath, firmware) => {
    set({ firmwarePath, firmware });
    get().persist();
  },
  setVerify: (verify) => {
    set({ verify });
    get().persist();
  },
  setRunAfter: (runAfter) => {
    set({ runAfter });
    get().persist();
  },
  setDtrRtsEnabled: (dtrRtsEnabled) => {
    set({ dtrRtsEnabled });
    get().persist();
  },
  setRtsFunc: (rtsFunc) => {
    set({ rtsFunc });
    get().persist();
  },
  setRtsLevel: (rtsLevel) => {
    set({ rtsLevel });
    get().persist();
  },
  setDtrFunc: (dtrFunc) => {
    set({ dtrFunc });
    get().persist();
  },
  setDtrLevel: (dtrLevel) => {
    set({ dtrLevel });
    get().persist();
  },
  setFlashReadAddress: (flashReadAddress) => {
    set({ flashReadAddress });
    get().persist();
  },
  setFlashReadSize: (flashReadSize) => {
    set({ flashReadSize });
    get().persist();
  },
  setAvrProgrammer: (avrProgrammer) => {
    set({ avrProgrammer });
    get().persist();
  },
  setAvrChip: (avrChip) => {
    set({ avrChip });
    get().persist();
  },
  clearFirmware: () => {
    set({ firmwarePath: "", firmware: null });
    get().persist();
  },
  persist: () => {
    const state = get();
    const toSave: FlashStoreState = {
      flashModule: state.flashModule,
      firmwarePath: state.firmwarePath,
      firmware: state.firmware,
      verify: state.verify,
      runAfter: state.runAfter,
      dtrRtsEnabled: state.dtrRtsEnabled,
      rtsFunc: state.rtsFunc,
      rtsLevel: state.rtsLevel,
      dtrFunc: state.dtrFunc,
      dtrLevel: state.dtrLevel,
      flashReadAddress: state.flashReadAddress,
      flashReadSize: state.flashReadSize,
      avrProgrammer: state.avrProgrammer,
      avrChip: state.avrChip,
    };
    localStorage.setItem("serialhelper-flash", JSON.stringify(toSave));
  },
}));
