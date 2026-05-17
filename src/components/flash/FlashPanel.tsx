import { useCallback, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { PortSelector } from "@/components/shared/PortSelector";
import { BaudRateInput } from "@/components/shared/BaudRateInput";
import { ThemeSelect } from "@/components/shared/ThemeSelect";
import { Toggle } from "@/components/shared/Toggle";
import { Zap, Upload, XCircle, CheckCircle, Loader2, Cpu, Trash2, FileDown } from "lucide-react";
import clsx from "clsx";

interface FirmwareInfo {
  filename: string;
  format: string;
  size: number;
  segments: { address: number; size: number; range: string }[];
  checksum: string;
}

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const stageLabels: Record<string, string> = {
  parsing: "Parsing", connecting: "Opening", bootloader: "Bootloader",
  detecting: "Detecting", erasing: "Erasing", writing: "Writing",
  verifying: "Verifying", resetting: "Starting", reading: "Reading", complete: "Done",
};

export function FlashPanel() {
  const { t } = useTranslation("flash");

  const [firmware, setFirmware] = useState<FirmwareInfo | null>(null);
  const [firmwarePath, setFirmwarePath] = useState("");
  const [chipInfo, setChipInfo] = useState<ChipInfoResult | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [flashLog, setFlashLog] = useState<string[]>([]);
  const [flashResult, setFlashResult] = useState<"success" | "error" | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [optVerify, setOptVerify] = useState(true);
  const [optRunAfter, setOptRunAfter] = useState(true);
  const [dtrRtsEnabled, setDtrRtsEnabled] = useState(true);
  // Per-pin DTR/RTS config
  const [rtsFunc, setRtsFunc] = useState("reset");
  const [rtsLevel, setRtsLevel] = useState("low");
  const [dtrFunc, setDtrFunc] = useState("bootloader");
  const [dtrLevel, setDtrLevel] = useState("high");

  const portName = useSerialStore((s) => s.config.port_name);
  const baudRate = useSerialStore((s) => s.config.baud_rate);
  const setConfig = useSerialStore((s) => s.setConfig);
  const isConnected = useSerialStore((s) => s.isConnected);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);

  const unlistenRef = useRef<UnlistenFn | null>(null);

  const addLog = useCallback((msg: string) => setFlashLog((prev) => [...prev, msg]), []);
  const clearLog = useCallback(() => setFlashLog([]), []);

  // ─── File handling ───
  const handleFile = useCallback(async (filePath: string) => {
    try {
      const info = await invoke<FirmwareInfo>("parse_firmware", { filePath, baseAddress: null });
      setFirmware(info);
      setFirmwarePath(filePath);
      setFlashResult(null);
      addLog(`[OK] ${info.filename} — ${info.format}, ${formatSize(info.size)}, ${info.segments.length} segment(s)`);
    } catch (e: any) { addLog(`[ERROR] ${e}`); }
  }, [addLog]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { const path = (file as any).path || file.name; if (path) handleFile(path); }
  }, [handleFile]);

  const handleFilePicker = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".hex,.bin,.ihx,.srec,.elf,.dfu";
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) { const path = (file as any).path || file.name; if (path) handleFile(path); }
    };
    input.click();
  }, [handleFile]);

  // ─── Helpers ───
  const handleReadChip = useCallback(async () => {
    if (!portName) return;
    clearLog(); setFlashing(true); setProgress(null);
    addLog("[INFO] Connecting to detect chip...");
    try {
      const info = await invoke<ChipInfoResult>("read_chip_info", {
        portName, baudRate, autoReset: false,  // read-only: no reset
      });
      setChipInfo(info);
      addLog(`[OK] Device ID: ${info.device_id_hex} | Bootloader v${info.bootloader_version >> 4}.${info.bootloader_version & 0xF}`);
      if (info.chip_match) {
        addLog(`[OK] ${info.chip_match.name} (${info.chip_match.flash_kb}KB Flash / ${info.chip_match.ram_kb}KB RAM)`);
      } else {
        addLog(`[WARN] Unknown chip — flash anyway if firmware is correct`);
      }
    } catch (e: any) { addLog(`[ERROR] ${e}`); }
    finally { setFlashing(false); }
  }, [portName, baudRate, addLog, clearLog]);

  const handleErase = useCallback(async () => {
    if (!portName || !confirm(t("erase") + " ALL flash? This cannot be undone.")) return;
    clearLog(); setFlashing(true); setFlashResult(null);
    try {
      await invoke("erase_chip", { portName, baudRate, autoReset: false });
      addLog("[OK] Flash erased");
    } catch (e: any) { addLog(`[ERROR] ${e}`); }
    finally { setFlashing(false); }
  }, [portName, baudRate, t, addLog, clearLog]);

  const handleReadFlash = useCallback(async () => {
    if (!portName || !chipInfo?.chip_match) return;
    const chip = chipInfo.chip_match;
    const savePath = `${chip.name}_flash_backup.bin`;
    clearLog(); setFlashing(true);
    try {
      await invoke("read_flash", {
        portName, baudRate, autoReset: false,
        startAddress: chip.flash_start, size: chip.flash_kb * 1024, savePath,
      });
      addLog(`[OK] Flash saved to ${savePath}`);
    } catch (e: any) { addLog(`[ERROR] ${e}`); }
    finally { setFlashing(false); }
  }, [portName, baudRate, chipInfo, addLog, clearLog]);

  // ─── Flash ───
  const handleFlash = useCallback(async () => {
    if (!firmwarePath || !portName || !firmware) return;
    setFlashing(true); clearLog(); setProgress(null); setFlashResult(null);
    setState("FLASHING");

    if (isConnected || appState === "MONITORING") {
      try { await invoke("close_port"); } catch { /* ignore */ }
    }

    const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
      setProgress(event.payload);
      addLog(`[${event.payload.stage}] ${event.payload.message}`);
    });
    unlistenRef.current = unlisten;

    try {
      await invoke("start_flash", {
        firmwarePath, portName, baudRate,
        options: {
          verify: optVerify, runAfter: optRunAfter, autoReset: dtrRtsEnabled,
          dtrRts: { rtsFunction: rtsFunc, rtsActiveLevel: rtsLevel, dtrFunction: dtrFunc, dtrActiveLevel: dtrLevel },
        },
      });
      setFlashResult("success");
    } catch (e: any) {
      setFlashResult("error");
      addLog(`[ERROR] ${e}`);
    } finally {
      setFlashing(false); setState("IDLE");
      unlisten(); unlistenRef.current = null;
    }
  }, [firmwarePath, portName, baudRate, firmware, isConnected, appState, optVerify, optRunAfter, dtrRtsEnabled, addLog, clearLog, setState]);

  const canFlash = firmwarePath && portName && !flashing;
  const canHelper = portName && !flashing;
  const rowBtn = "flex items-center gap-1.5 px-2.5 h-7 text-[0.6875rem] rounded border transition-colors";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
          <Zap size={14} className="text-flash" />{t("title")}
        </h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Port row */}
        <div className="flex items-center gap-1.5">
          <PortSelector value={portName} onChange={(p) => setConfig({ port_name: p })} disabled={isConnected} />
          <BaudRateInput value={baudRate} onChange={(b) => setConfig({ baud_rate: b })} disabled={isConnected} />
        </div>

        {/* DTR/RTS row — separator line + controls like monitor toolbar */}
        <div className="flex items-center gap-1.5 py-1.5 px-2.5 -mx-4 border-y border-border bg-surface-alt/50">
          <div className="flex items-center gap-2">
            <Toggle active={dtrRtsEnabled} onClick={() => setDtrRtsEnabled(!dtrRtsEnabled)} />
            <span className="text-[0.6875rem] text-text-secondary font-medium">{t("dtrRts")}</span>
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          {dtrRtsEnabled && (
            <>
              <span className="text-[0.625rem] text-text-muted ml-1">{t("rtsFunction")}</span>
              <ThemeSelect value={rtsLevel} onChange={setRtsLevel} options={[
                { value: "low", label: t("levelLow") },
                { value: "high", label: t("levelHigh") },
              ]} className="min-w-[56px]" />
              <ThemeSelect value={rtsFunc} onChange={setRtsFunc} options={[
                { value: "none", label: t("funcNone") },
                { value: "reset", label: t("funcReset") },
                { value: "bootloader", label: t("funcBootloader") },
              ]} className="min-w-[100px]" />
              <span className="text-[0.625rem] text-text-muted ml-2">{t("dtrFunction")}</span>
              <ThemeSelect value={dtrLevel} onChange={setDtrLevel} options={[
                { value: "low", label: t("levelLow") },
                { value: "high", label: t("levelHigh") },
              ]} className="min-w-[56px]" />
              <ThemeSelect value={dtrFunc} onChange={setDtrFunc} options={[
                { value: "none", label: t("funcNone") },
                { value: "reset", label: t("funcReset") },
                { value: "bootloader", label: t("funcBootloader") },
              ]} className="min-w-[100px]" />
            </>
          )}
        </div>

        {/* Options */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Toggle active={optVerify} onClick={() => setOptVerify(!optVerify)} />
            <span className="text-[0.6875rem] text-text-secondary">{t("verify")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle active={optRunAfter} onClick={() => setOptRunAfter(!optRunAfter)} />
            <span className="text-[0.6875rem] text-text-secondary">{t("runAfter")}</span>
          </div>
        </div>

        {/* Helper buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={handleReadChip} disabled={!canHelper || flashing} className={clsx(rowBtn, "bg-surface border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40")}>
            <Cpu size={13} />{t("readChip")}
          </button>
          <button onClick={handleErase} disabled={!canHelper || flashing} className={clsx(rowBtn, "bg-surface border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40")}>
            <Trash2 size={13} />{t("erase")}
          </button>
          <button onClick={handleReadFlash} disabled={!canHelper || !chipInfo?.chip_match || flashing} className={clsx(rowBtn, "bg-surface border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40")}>
            <FileDown size={13} />{t("readFlash")}
          </button>
        </div>

        {/* Chip info */}
        {chipInfo && (
          <div className="p-3 rounded-lg border border-border bg-surface-alt/30 text-[0.6875rem] font-mono space-y-0.5">
            <p>Device ID: <span className="text-accent">{chipInfo.device_id_hex}</span> | Bootloader: v{chipInfo.bootloader_version >> 4}.{chipInfo.bootloader_version & 0xF}</p>
            {chipInfo.chip_match ? (
              <p className="text-green-600 dark:text-green-400">
                {chipInfo.chip_match.name} ({chipInfo.chip_match.flash_kb}KB Flash / {chipInfo.chip_match.ram_kb}KB RAM)
              </p>
            ) : (
              <p className="text-yellow-500">Unknown chip — flash anyway if firmware is correct</p>
            )}
          </div>
        )}

        {/* Firmware drop zone */}
        <div
          onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onClick={handleFilePicker}
          className={clsx(
            "relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            dragOver ? "border-accent bg-accent/5" : firmware ? "border-green-500/30 bg-green-500/5" : "border-border hover:border-border-strong bg-surface-alt/20"
          )}
        >
          {firmware ? (
            <div className="space-y-1">
              <CheckCircle size={24} className="mx-auto text-green-500" />
              <p className="text-[0.6875rem] font-medium text-text-primary">{firmware.filename}</p>
              <p className="text-[0.625rem] text-text-muted">{firmware.format} · {formatSize(firmware.size)} · {firmware.segments.length} segment(s)</p>
              {firmware.segments.map((s, i) => (
                <p key={i} className="text-[0.5625rem] text-text-muted font-mono">{s.range}</p>
              ))}
              <p className="text-[0.5625rem] text-text-muted font-mono mt-1">SHA256: {firmware.checksum.slice(0, 16)}...</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload size={24} className="mx-auto text-text-muted" />
              <p className="text-[0.6875rem] text-text-secondary">{t("dropFileHint")}</p>
              <p className="text-[0.5625rem] text-text-muted">{t("supportedFormats")}</p>
            </div>
          )}
        </div>

        {/* Flash button */}
        <button
          onClick={handleFlash} disabled={!canFlash}
          className={clsx(
            "w-full py-2 px-4 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2",
            canFlash ? "bg-flash text-white hover:opacity-90" : "bg-surface-alt border border-border text-text-muted cursor-not-allowed"
          )}
        >
          {flashing ? (
            <><Loader2 size={14} className="animate-spin" />{stageLabels[progress?.stage || "writing"]} ({progress?.percent || 0}%)</>
          ) : (
            <><Zap size={14} />{t("startFlash")}</>
          )}
        </button>

        {/* Progress */}
        {flashing && progress && (
          <div className="space-y-1">
            <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden border border-border">
              <div className="h-full bg-flash rounded-full transition-all duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-[0.625rem] text-text-muted text-center">{stageLabels[progress.stage]} — {progress.percent}%</p>
          </div>
        )}

        {/* Result */}
        {flashResult && (
          <div className={clsx("p-3 rounded-lg flex items-center gap-2 text-[0.6875rem]", flashResult === "success" ? "bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400" : "bg-flash-error/10 border border-flash-error/30 text-flash-error")}>
            {flashResult === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {flashResult === "success" ? "Flash complete!" : "Flash failed — see log below"}
          </div>
        )}

        {/* Log */}
        {flashLog.length > 0 && (
          <div className="p-3 rounded-lg border border-border bg-surface-alt/30 font-mono text-[0.625rem] max-h-48 overflow-auto space-y-0.5 select-text">
            {flashLog.map((l, i) => (
              <p key={i} className={l.startsWith("[ERROR]") ? "text-flash-error" : l.startsWith("[WARN]") ? "text-yellow-500" : "text-text-secondary"}>{l}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
