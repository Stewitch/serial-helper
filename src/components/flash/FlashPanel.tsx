import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useFlashStore, type FirmwareInfo } from "@/stores/flashStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { PortSelector } from "@/components/shared/PortSelector";
import { BaudRateInput } from "@/components/shared/BaudRateInput";
import { ThemeSelect } from "@/components/shared/ThemeSelect";
import { Toggle } from "@/components/shared/Toggle";
import { Zap, Upload, XCircle, CheckCircle, Loader2, Cpu, Trash2, FileDown } from "lucide-react";
import clsx from "clsx";
import type { SerialConfig } from "@/types/serial";

interface FlashProgress {
  stage: string;
  percent: number;
  message: string;
}

interface ChipInfoResult {
  device_id: number;
  device_id_hex: string;
  pid: number | null;
  bootloader_version: number;
  chip_match: {
    family: string;
    name: string;
    device_id: number;
    flash_kb: number;
    flash_start: number;
    ram_kb: number;
    page_size: number;
  } | null;
}

interface ConnectOptions {
  autoReset: boolean;
  dtrRts: {
    rtsFunction: string;
    rtsActiveLevel: string;
    dtrFunction: string;
    dtrActiveLevel: string;
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const stageLabels: Record<string, string> = {
  parsing: "Parsing",
  connecting: "Opening",
  bootloader: "Bootloader",
  detecting: "Detecting",
  erasing: "Erasing",
  writing: "Writing",
  verifying: "Verifying",
  resetting: "Starting",
  reading: "Reading",
  complete: "Done",
  resuming: "Resuming",
  sync: "Sync",
};

function stageLabel(stage: string | undefined): string {
  if (!stage) return "Working";
  return stageLabels[stage] ?? `${stage.charAt(0).toUpperCase()}${stage.slice(1)}`;
}

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

function toHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function parseHexInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const parsed = parseInt(normalized, 16);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

export function FlashPanel() {
  const { t } = useTranslation("flash");

  const [chipInfo, setChipInfo] = useState<ChipInfoResult | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [flashLog, setFlashLog] = useState<Array<{ id: number; text: string; replaceKey?: string }>>([]);
  const [flashResult, setFlashResult] = useState<"success" | "error" | "cancelled" | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const portName = useSerialStore((s) => s.config.port_name);
  const baudRate = useSerialStore((s) => s.config.baud_rate);
  const serialConfig = useSerialStore((s) => s.config);
  const setConfig = useSerialStore((s) => s.setConfig);
  const setConnected = useSerialStore((s) => s.setConnected);
  const isConnected = useSerialStore((s) => s.isConnected);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const firmware = useFlashStore((s) => s.firmware);
  const firmwarePath = useFlashStore((s) => s.firmwarePath);
  const setFirmwareSelection = useFlashStore((s) => s.setFirmwareSelection);
  const optVerify = useFlashStore((s) => s.verify);
  const setOptVerify = useFlashStore((s) => s.setVerify);
  const optRunAfter = useFlashStore((s) => s.runAfter);
  const setOptRunAfter = useFlashStore((s) => s.setRunAfter);
  const dtrRtsEnabled = useFlashStore((s) => s.dtrRtsEnabled);
  const setDtrRtsEnabled = useFlashStore((s) => s.setDtrRtsEnabled);
  const rtsFunc = useFlashStore((s) => s.rtsFunc);
  const setRtsFunc = useFlashStore((s) => s.setRtsFunc);
  const rtsLevel = useFlashStore((s) => s.rtsLevel);
  const setRtsLevel = useFlashStore((s) => s.setRtsLevel);
  const dtrFunc = useFlashStore((s) => s.dtrFunc);
  const setDtrFunc = useFlashStore((s) => s.setDtrFunc);
  const dtrLevel = useFlashStore((s) => s.dtrLevel);
  const setDtrLevel = useFlashStore((s) => s.setDtrLevel);
  const flashReadAddress = useFlashStore((s) => s.flashReadAddress);
  const setFlashReadAddress = useFlashStore((s) => s.setFlashReadAddress);
  const flashReadSize = useFlashStore((s) => s.flashReadSize);
  const setFlashReadSize = useFlashStore((s) => s.setFlashReadSize);
  const autoResumeMonitor = useSettingsStore((s) => s.autoResumeMonitor);
  const autoNavigateMonitorAfterFlash = useSettingsStore((s) => s.autoNavigateMonitorAfterFlash);
  const setAutoResumeMonitor = useSettingsStore((s) => s.setAutoResumeMonitor);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const logIdRef = useRef(0);
  const lastFirmwareSignatureRef = useRef<string | null>(null);

  const addLog = useCallback((msg: string, replaceKey?: string) => {
    setFlashLog((prev) => {
      if (replaceKey) {
        let index = -1;
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          if (prev[i].replaceKey === replaceKey) {
            index = i;
            break;
          }
        }
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], text: msg };
          return next;
        }
      }
      return [...prev, { id: logIdRef.current++, text: msg, replaceKey }];
    });
  }, []);
  const clearLog = useCallback(() => {
    setFlashLog([]);
    logIdRef.current = 0;
  }, []);

  const connectOptions: ConnectOptions = {
    autoReset: dtrRtsEnabled,
    dtrRts: {
      rtsFunction: rtsFunc,
      rtsActiveLevel: rtsLevel,
      dtrFunction: dtrFunc,
      dtrActiveLevel: dtrLevel,
    },
  };

  const prepareFlashPort = useCallback(async (): Promise<SerialConfig | null> => {
    const shouldResume = isConnected || appState === "MONITORING";
    const resumeConfig = shouldResume ? { ...serialConfig } : null;

    if (shouldResume) {
      try {
        await invoke("close_port");
      } catch {
        // ignore
      } finally {
        setConnected(null);
      }
    }

    return resumeConfig;
  }, [isConnected, appState, serialConfig, setConnected]);

  const resumeMonitor = useCallback(async (resumeConfig: SerialConfig | null) => {
    if (!resumeConfig || !autoResumeMonitor || !optRunAfter) {
      setState("IDLE");
      return;
    }

    setState("RESUMING_MONITOR");
    addLog(`[resuming] ${t("progress.resumingMonitor")}`);

    try {
      await invoke("open_port", { config: resumeConfig });
      setConnected(resumeConfig.port_name);
      addLog(`[OK] Monitor resumed on ${resumeConfig.port_name}`);
      if (autoNavigateMonitorAfterFlash) {
        setActivePage("monitor");
      }
      setState("MONITORING");
    } catch (e) {
      addLog(`[WARN] Failed to resume monitor: ${extractError(e)}`);
      setState("IDLE");
    }
  }, [autoResumeMonitor, autoNavigateMonitorAfterFlash, optRunAfter, addLog, setConnected, setActivePage, setState, t]);

  const handleFile = useCallback(async (filePath: string) => {
    try {
      const info = await invoke<FirmwareInfo>("parse_firmware_cached", { filePath, baseAddress: null });
      setFirmwareSelection(filePath, info);
      setFlashResult(null);
      lastFirmwareSignatureRef.current = `${info.checksum}:${info.size}`;
      addLog(`[OK] ${info.filename} - ${info.format}, ${formatSize(info.size)}, ${info.segments.length} segment(s)`);
    } catch (e) {
      addLog(`[ERROR] ${extractError(e)}`);
    }
  }, [addLog, setFirmwareSelection]);

  useEffect(() => {
    if (!firmwarePath || flashing) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const info = await invoke<FirmwareInfo>("parse_firmware_cached", { filePath: firmwarePath, baseAddress: null });
        if (cancelled) return;

        const signature = `${info.checksum}:${info.size}`;
        if (lastFirmwareSignatureRef.current !== signature) {
          lastFirmwareSignatureRef.current = signature;
          setFirmwareSelection(firmwarePath, info);
          setFlashResult(null);
          addLog(
            `[INFO] Firmware refreshed: ${info.filename} - ${info.format}, ${formatSize(info.size)}, ${info.segments.length} segment(s)`,
            "firmware-refresh"
          );
        }
      } catch {
        // Ignore transient read/parse failures while the file is being rebuilt.
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [firmwarePath, flashing, addLog, setFirmwareSelection]);

  const progressLogKey = useCallback((stage: string, message: string): string | undefined => {
    if (stage === "reading") return "progress-reading";
    if (stage === "writing") return "progress-writing";
    if (stage === "verifying") return "progress-verifying";
    if (stage === "sync") return "progress-sync";
    if (stage === "bootloader" && (message.includes("attempt") || message.includes("retrying") || message.includes("Sync"))) {
      return "progress-bootloader";
    }
    return undefined;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const path = (file as { path?: string }).path ?? file.name;
      if (path) handleFile(path);
    }
  }, [handleFile]);

  const handleFilePicker = useCallback(() => {
    void (async () => {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Firmware", extensions: ["hex", "ihx", "bin"] },
        ],
      });
      if (typeof selected === "string" && selected) {
        await handleFile(selected);
      }
    })();
  }, [handleFile]);

  const handleReadChip = useCallback(async () => {
    if (!portName) return;
    clearLog();
    setFlashing(true);
    setProgress(null);
    addLog("[INFO] Connecting to detect chip...");

    const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.message) {
        addLog(
          `[${event.payload.stage}] ${event.payload.message}`,
          progressLogKey(event.payload.stage, event.payload.message)
        );
      }
    });

    try {
      await prepareFlashPort();
      setState("FLASHING");
      const info = await invoke<ChipInfoResult>("read_chip_info", {
        portName,
        baudRate,
        options: connectOptions,
      });
      setChipInfo(info);
      if (info.chip_match) {
        setFlashReadAddress(toHex(info.chip_match.flash_start));
        setFlashReadSize(toHex(info.chip_match.flash_kb * 1024));
      }
      addLog(`[OK] Device ID: ${info.device_id_hex} | Bootloader v${info.bootloader_version >> 4}.${info.bootloader_version & 0xF}`);
      if (info.chip_match) {
        addLog(`[OK] ${info.chip_match.name} (${info.chip_match.flash_kb}KB Flash / ${info.chip_match.ram_kb}KB RAM)`);
      } else {
        addLog("[WARN] Unknown chip");
      }
    } catch (e) {
      addLog(`[ERROR] ${extractError(e)}`);
    } finally {
      setFlashing(false);
      setState("IDLE");
      unlisten();
    }
  }, [portName, baudRate, clearLog, addLog, prepareFlashPort, setState, connectOptions]);

  const handleErase = useCallback(async () => {
    if (!portName || !confirm(`${t("erase")} ALL flash?`)) return;
    clearLog();
    setFlashing(true);
    setFlashResult(null);
    setProgress(null);

    const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.message) {
        addLog(
          `[${event.payload.stage}] ${event.payload.message}`,
          progressLogKey(event.payload.stage, event.payload.message)
        );
      }
    });

    try {
      await prepareFlashPort();
      setState("FLASHING");
      await invoke("erase_chip", { portName, baudRate, options: connectOptions });
      addLog("[OK] Flash erased");
    } catch (e) {
      addLog(`[ERROR] ${extractError(e)}`);
    } finally {
      setFlashing(false);
      setState("IDLE");
      unlisten();
    }
  }, [portName, baudRate, t, clearLog, addLog, prepareFlashPort, setState, connectOptions]);

  const handleReadFlash = useCallback(async () => {
    if (!portName || !chipInfo?.chip_match) return;
    const startAddress = parseHexInput(flashReadAddress);
    const size = parseHexInput(flashReadSize);
    if (startAddress === null || size === null || size <= 0) {
      addLog("[ERROR] Invalid flash read range");
      return;
    }
    if (startAddress > 0xFFFFFFFF || size > 0xFFFFFFFF) {
      addLog("[ERROR] Flash read range exceeds 32-bit address limits");
      return;
    }
    if (startAddress % 4 !== 0) {
      addLog("[ERROR] Flash read start address must be 4-byte aligned");
      return;
    }
    const flashStart = chipInfo.chip_match.flash_start;
    const flashEnd = flashStart + chipInfo.chip_match.flash_kb * 1024;
    const endAddress = startAddress + size;
    if (!Number.isSafeInteger(endAddress) || endAddress > flashEnd) {
      addLog(`[ERROR] Flash read range exceeds chip flash (${toHex(flashStart)} - ${toHex(flashEnd)})`);
      return;
    }
    if (startAddress < flashStart) {
      addLog(`[ERROR] Flash read start address must be within chip flash (${toHex(flashStart)} - ${toHex(flashEnd)})`);
      return;
    }

    const savePath = `${chipInfo.chip_match.name}_flash_${startAddress.toString(16).toUpperCase()}_${size.toString(16).toUpperCase()}.bin`;
    clearLog();
    setFlashing(true);
    setProgress(null);

    const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.message) {
        addLog(
          `[${event.payload.stage}] ${event.payload.message}`,
          progressLogKey(event.payload.stage, event.payload.message)
        );
      }
    });

    try {
      await prepareFlashPort();
      setState("FLASHING");
      await invoke("read_flash", {
        portName,
        baudRate,
        options: connectOptions,
        startAddress,
        size,
        savePath,
      });
      addLog(`[OK] Flash saved to ${savePath}`);
    } catch (e) {
      addLog(`[ERROR] ${extractError(e)}`);
    } finally {
      setFlashing(false);
      setState("IDLE");
      unlisten();
    }
  }, [portName, baudRate, chipInfo, flashReadAddress, flashReadSize, clearLog, addLog, prepareFlashPort, setState, connectOptions]);

  const handleFlash = useCallback(async () => {
    if (!firmwarePath || !portName || !firmware) return;
    setFlashing(true);
    clearLog();
    setProgress(null);
    setFlashResult(null);
    setState("FLASHING");
    let resumeConfig: SerialConfig | null = null;

    const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.message) {
        addLog(
          `[${event.payload.stage}] ${event.payload.message}`,
          progressLogKey(event.payload.stage, event.payload.message)
        );
      }
    });
    unlistenRef.current = unlisten;

    try {
      resumeConfig = await prepareFlashPort();
      await invoke("start_flash", {
        firmwarePath,
        portName,
        baudRate,
        options: {
          verify: optVerify,
          runAfter: optRunAfter,
          autoReset: dtrRtsEnabled,
          dtrRts: connectOptions.dtrRts,
        },
      });
      setFlashResult("success");
      await resumeMonitor(resumeConfig);
    } catch (e) {
      const msg = extractError(e);
      if (msg.includes("Flash cancelled") || msg.includes("Cancelled")) {
        setFlashResult("cancelled");
        addLog(`[INFO] Operation cancelled`);
      } else {
        setFlashResult("error");
        addLog(`[ERROR] ${msg}`);
        setState("FLASH_ERROR");
      }
    } finally {
      setFlashing(false);
      if (useAppStore.getState().appState === "FLASHING") {
        setState("IDLE");
      }
      unlisten();
      unlistenRef.current = null;
    }
  }, [
    firmwarePath,
    portName,
    baudRate,
    firmware,
    optVerify,
    optRunAfter,
    dtrRtsEnabled,
    clearLog,
    addLog,
    setState,
    prepareFlashPort,
    connectOptions,
    resumeMonitor,
  ]);

  const handleCancel = useCallback(async () => {
    try {
      await invoke("cancel_flash");
      addLog("[INFO] Cancelling...");
    } catch (e) {
      addLog(`[WARN] Cancel failed: ${extractError(e)}`);
    }
  }, [addLog]);

  const canFlash = Boolean(firmwarePath && portName && !flashing);
  const canHelper = Boolean(portName && !flashing);
  const rowBtn = "flex items-center gap-1.5 px-2.5 h-7 text-[0.6875rem] rounded border transition-colors";
  const inputClass = "h-7 px-2.5 rounded border border-border bg-surface text-[0.6875rem] text-text-secondary font-mono focus:outline-none focus:border-accent";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
          <Zap size={14} className="text-flash" />
          {t("title")}
        </h2>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-surface-alt/50">
          <PortSelector value={portName} onChange={(p) => setConfig({ port_name: p })} disabled={isConnected || flashing} />
          <BaudRateInput value={baudRate} onChange={(b) => setConfig({ baud_rate: b })} disabled={isConnected || flashing} />
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-surface-alt/50">
          <div className="flex items-center gap-2">
            <Toggle active={dtrRtsEnabled} onClick={() => setDtrRtsEnabled(!dtrRtsEnabled)} />
            <span className="text-[0.6875rem] text-text-secondary font-medium">{t("dtrRts")}</span>
          </div>
          <div className="w-px h-5 bg-border mx-0.5" />
          {dtrRtsEnabled && (
            <>
              <span className="text-[0.625rem] text-text-muted">{t("rtsFunction")}</span>
              <ThemeSelect
                value={rtsLevel}
                onChange={setRtsLevel}
                options={[
                  { value: "low", label: t("levelLow") },
                  { value: "high", label: t("levelHigh") },
                ]}
                className="min-w-[56px]"
              />
              <ThemeSelect
                value={rtsFunc}
                onChange={setRtsFunc}
                options={[
                  { value: "none", label: t("funcNone") },
                  { value: "reset", label: t("funcReset") },
                  { value: "bootloader", label: t("funcBootloader") },
                ]}
                className="min-w-[96px]"
              />
              <div className="w-px h-5 bg-border mx-0.5" />
              <span className="text-[0.625rem] text-text-muted">{t("dtrFunction")}</span>
              <ThemeSelect
                value={dtrLevel}
                onChange={setDtrLevel}
                options={[
                  { value: "low", label: t("levelLow") },
                  { value: "high", label: t("levelHigh") },
                ]}
                className="min-w-[56px]"
              />
              <ThemeSelect
                value={dtrFunc}
                onChange={setDtrFunc}
                options={[
                  { value: "none", label: t("funcNone") },
                  { value: "reset", label: t("funcReset") },
                  { value: "bootloader", label: t("funcBootloader") },
                ]}
                className="min-w-[96px]"
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-4 px-2.5 py-1.5 border-b border-border bg-surface-alt/50">
          <div className="flex items-center gap-2">
            <Toggle active={optVerify} onClick={() => setOptVerify(!optVerify)} />
            <span className="text-[0.6875rem] text-text-secondary">{t("verify")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle active={optRunAfter} onClick={() => setOptRunAfter(!optRunAfter)} />
            <span className="text-[0.6875rem] text-text-secondary">{t("runAfter")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle active={autoResumeMonitor} onClick={() => setAutoResumeMonitor(!autoResumeMonitor)} />
            <span className="text-[0.6875rem] text-text-secondary">{t("autoResumeMonitor")}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-surface-alt/50 flex-wrap">
          <button
            onClick={handleReadChip}
            disabled={!canHelper}
            className={clsx(rowBtn, "bg-surface border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40")}
          >
            <Cpu size={13} />
            {t("readChip")}
          </button>
          <button
            onClick={handleErase}
            disabled={!canHelper}
            className={clsx(rowBtn, "bg-surface border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40")}
          >
            <Trash2 size={13} />
            {t("erase")}
          </button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <span className="text-[0.625rem] text-text-muted">Read</span>
          <input
            value={flashReadAddress}
            onChange={(e) => setFlashReadAddress(e.target.value)}
            className={clsx(inputClass, "w-[120px]")}
            placeholder="0x08000000"
            disabled={flashing}
          />
          <input
            value={flashReadSize}
            onChange={(e) => setFlashReadSize(e.target.value)}
            className={clsx(inputClass, "w-[92px]")}
            placeholder="0x20000"
            disabled={flashing}
          />
          <button
            onClick={handleReadFlash}
            disabled={!canHelper || !chipInfo?.chip_match}
            className={clsx(rowBtn, "bg-surface border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40")}
          >
            <FileDown size={13} />
            {t("readFlash")}
          </button>
        </div>

        <div className="p-3 space-y-3">
          {chipInfo && (
            <div className="rounded-lg border border-border bg-surface-alt/30 p-3 text-[0.6875rem] font-mono space-y-0.5">
              <p>
                Device ID: <span className="text-accent">{chipInfo.device_id_hex}</span> | Bootloader: v
                {chipInfo.bootloader_version >> 4}.{chipInfo.bootloader_version & 0xF}
              </p>
              {chipInfo.chip_match ? (
                <p className="text-green-600 dark:text-green-400">
                  {chipInfo.chip_match.name} ({chipInfo.chip_match.flash_kb}KB Flash / {chipInfo.chip_match.ram_kb}KB RAM)
                </p>
              ) : (
                <p className="text-yellow-500">Unknown chip - flash only if the firmware target is confirmed</p>
              )}
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={handleFilePicker}
            className={clsx(
              "relative border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors",
              dragOver ? "border-accent bg-accent/5" : firmware ? "border-green-500/30 bg-green-500/5" : "border-border hover:border-border-strong bg-surface-alt/20"
            )}
          >
            {firmware ? (
              <div className="space-y-1">
                <CheckCircle size={24} className="mx-auto text-green-500" />
                <p className="text-[0.6875rem] font-medium text-text-primary">{firmware.filename}</p>
                <p className="text-[0.625rem] text-text-muted">
                  {firmware.format} · {formatSize(firmware.size)} · {firmware.segments.length} segment(s)
                </p>
                {firmware.segments.map((segment, index) => (
                  <p key={index} className="text-[0.5625rem] text-text-muted font-mono">
                    {segment.range}
                  </p>
                ))}
                <p className="text-[0.5625rem] text-text-muted font-mono mt-1">
                  SHA256: {firmware.checksum.slice(0, 16)}...
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload size={24} className="mx-auto text-text-muted" />
                <p className="text-[0.6875rem] text-text-secondary">{t("dropFileHint")}</p>
                <p className="text-[0.5625rem] text-text-muted">{t("supportedFormats")}</p>
              </div>
            )}
          </div>

          <button
            onClick={handleFlash}
            disabled={!canFlash}
            className={clsx(
              "w-full py-2 px-4 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2",
              canFlash ? "bg-flash text-white hover:opacity-90" : "bg-surface-alt border border-border text-text-muted cursor-not-allowed"
            )}
          >
            {flashing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {stageLabel(progress?.stage)} ({progress?.percent || 0}%)
              </>
            ) : (
              <>
                <Zap size={14} />
                {t("startFlash")}
              </>
            )}
          </button>

          {flashing && (
            <button
              onClick={handleCancel}
              className="w-full py-2 px-4 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20"
            >
              <XCircle size={14} />
              Cancel
            </button>
          )}

          {flashing && progress && (
            <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-2">
              <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden border border-border">
                <div className="h-full bg-flash rounded-full transition-all duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="text-[0.625rem] text-text-muted text-center">
                {stageLabel(progress.stage)} - {progress.percent}%
              </p>
              <p className="text-[0.625rem] text-text-secondary text-center">{progress.message}</p>
            </div>
          )}

          {flashResult && (
            <div
              className={clsx(
                "p-3 rounded-lg flex items-center gap-2 text-[0.6875rem]",
                flashResult === "success"
                  ? "bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400"
                  : flashResult === "cancelled"
                    ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400"
                    : "bg-flash-error/10 border border-flash-error/30 text-flash-error"
              )}
            >
              {flashResult === "success" ? <CheckCircle size={16} /> : flashResult === "cancelled" ? <XCircle size={16} /> : <XCircle size={16} />}
              {flashResult === "success" ? "Flash complete!" : flashResult === "cancelled" ? "Operation cancelled" : "Flash failed - see log below"}
            </div>
          )}

          {flashLog.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-alt/30 p-3 font-mono text-[0.625rem] max-h-48 overflow-auto space-y-0.5 select-text">
              {flashLog.map((line) => (
                <p
                  key={line.id}
                  className={
                    line.text.startsWith("[ERROR]")
                      ? "text-flash-error"
                      : line.text.startsWith("[WARN]")
                        ? "text-yellow-500"
                        : "text-text-secondary"
                  }
                >
                  {line.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
