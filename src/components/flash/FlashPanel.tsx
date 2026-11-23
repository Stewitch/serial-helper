import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import { useFlashStore, type FirmwareInfo } from "@/stores/flashStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useModulesStore, type EnvStatus, type ModuleChip } from "@/stores/modulesStore";
import { monitorBuffer } from "@/lib/monitorBuffer";
import { Button, FieldGroup, FieldRow, Select, Switch } from "@/components/ui";
import type { SerialConfig } from "@/types/serial";
import { PageMap } from "./PageMap";
import { AVR_PROGRAMMERS } from "./avrChips";
import {
  advanceSteps,
  buildSteps,
  cellOf,
  failSteps,
  finishSteps,
  firmwareBytesPerCell,
  forEachCellSpan,
  formatSize,
  hex32,
  makeGeometry,
  parseHexInput,
  stepForStage,
  type FlashGeometry,
  type FlowKind,
  type Step,
} from "./flashModel";

interface FlashProgress {
  stage: string;
  percent: number;
  message: string;
  address?: number;
  length?: number;
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

type Operation = "flash" | "detect" | "erase" | "read";
type Outcome = { kind: "success" | "error" | "cancelled"; message?: string; seconds?: number } | null;
interface LogEntry {
  id: number;
  text: string;
  tone: "info" | "ok" | "warn" | "error";
  key?: string;
}

const FIRMWARE_EXTENSIONS = ["hex", "ihx", "bin"];

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

/** Stages whose messages update in place rather than adding a log line each time. */
function replaceKeyFor(stage: string): string | undefined {
  return ["reading", "writing", "verifying", "sync", "bootloader"].includes(stage) ? `progress-${stage}` : undefined;
}

export function FlashPanel() {
  const { t } = useTranslation("flash");

  /* ---------- Stores ---------- */
  const portName = useSerialStore((s) => s.config.port_name);
  const baudRate = useSerialStore((s) => s.config.baud_rate);
  const serialConfig = useSerialStore((s) => s.config);
  const setConnected = useSerialStore((s) => s.setConnected);
  const isConnected = useSerialStore((s) => s.isConnected);
  const appState = useAppStore((s) => s.appState);
  const setState = useAppStore((s) => s.setState);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const fs = useFlashStore();
  const autoResumeMonitor = useSettingsStore((s) => s.autoResumeMonitor);
  const setAutoResumeMonitor = useSettingsStore((s) => s.setAutoResumeMonitor);
  const autoNavigateMonitorAfterFlash = useSettingsStore((s) => s.autoNavigateMonitorAfterFlash);

  const modules = useModulesStore((s) => s.modules);
  const ensureModules = useModulesStore((s) => s.ensureModules);
  const moduleEnv = useModulesStore((s) => s.envByModule[fs.flashModule]);
  const setModuleEnv = useModulesStore((s) => s.setEnv);
  const module = modules.find((m) => m.id === fs.flashModule);
  const kind: FlowKind = fs.flashModule === "arduino-avr" ? "avr" : fs.flashModule === "stc89-stcgal" ? "stc89" : "stm32";
  const isAvr = kind === "avr";
  const isStc = kind === "stc89";
  const manualChip = kind !== "stm32";
  const firmware = fs.firmware;

  useEffect(() => {
    void ensureModules().catch(() => undefined);
  }, [ensureModules]);

  // Check the selected module's tools so a missing tool shows before flashing.
  useEffect(() => {
    if (!isTauri() || !module || module.required_tools.length === 0) return;
    let cancelled = false;
    void invoke<EnvStatus>("check_module_env", { moduleId: module.id })
      .then((env) => {
        if (!cancelled) setModuleEnv(module.id, env);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [module, setModuleEnv]);

  const selectedChipId = isAvr ? fs.avrChip : isStc ? fs.stcChip : null;
  const manualChipInfo: ModuleChip | undefined = selectedChipId ? module?.chips.find((c) => c.id === selectedChipId) : undefined;

  /* ---------- Local state ---------- */
  const [chipInfo, setChipInfo] = useState<ChipInfoResult | null>(null);
  const [op, setOp] = useState<Operation | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [written, setWritten] = useState<number[]>([]);
  const [activeCell, setActiveCell] = useState(-1);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [writeRate, setWriteRate] = useState<{ start: number; bytes: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const logId = useRef(0);
  const lastSignature = useRef<string | null>(null);
  const busy = op !== null;

  // Tick while busy so step durations and the ETA stay current.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [busy]);

  const addLog = useCallback((text: string, tone: LogEntry["tone"] = "info", key?: string) => {
    setLog((prev) => {
      if (key) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].key === key) {
            const next = prev.slice();
            next[i] = { ...next[i], text, tone };
            return next;
          }
        }
      }
      return [...prev, { id: logId.current++, text, tone, key }];
    });
  }, []);

  /* ---------- Geometry ---------- */
  const geometry: FlashGeometry | null = useMemo(() => {
    if (manualChip) {
      return manualChipInfo ? makeGeometry(manualChipInfo.flash_start, manualChipInfo.flash_kb * 1024, manualChipInfo.page_size) : null;
    }
    const m = chipInfo?.chip_match;
    if (m) return makeGeometry(m.flash_start, m.flash_kb * 1024, m.page_size);
    // Chip not identified yet: draw the span the firmware covers.
    if (firmware && firmware.segments.length > 0) {
      const lo = Math.min(...firmware.segments.map((s) => s.address));
      const hi = Math.max(...firmware.segments.map((s) => s.address + s.size));
      const start = Math.floor(lo / 1024) * 1024;
      return makeGeometry(start, Math.ceil((hi - start) / 1024) * 1024, 1024);
    }
    return null;
  }, [manualChip, manualChipInfo, chipInfo, firmware]);

  const firmwareCells = useMemo(
    () => (geometry && firmware ? firmwareBytesPerCell(geometry, firmware.segments) : null),
    [geometry, firmware]
  );
  const firmwarePages = firmwareCells ? firmwareCells.filter((n) => n > 0).length : 0;
  const writtenPages = firmwareCells ? firmwareCells.filter((n, i) => n > 0 && (written[i] ?? 0) >= n).length : 0;

  /* ---------- Firmware ---------- */
  const loadFirmware = useCallback(
    async (filePath: string) => {
      try {
        const info = await invoke<FirmwareInfo>("parse_firmware_cached", { filePath, baseAddress: null });
        fs.setFirmwareSelection(filePath, info);
        lastSignature.current = `${info.checksum}:${info.size}`;
        setOutcome(null);
        setWritten([]);
      } catch (e) {
        addLog(t("firmwareLoadFailed", { error: extractError(e) }), "error");
        setShowLog(true);
      }
    },
    [addLog, fs, t]
  );

  const pickFirmware = async () => {
    const selected = await open({ multiple: false, filters: [{ name: t("firmwareFilter"), extensions: FIRMWARE_EXTENSIONS }] });
    if (typeof selected === "string") await loadFirmware(selected);
  };

  // Native drag and drop gives real file paths.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragOver(true);
        else if (p.type === "leave") setDragOver(false);
        else if (p.type === "drop") {
          setDragOver(false);
          const file = p.paths.find((path) => FIRMWARE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? ""));
          if (file && !busy) void loadFirmware(file);
        }
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, [busy, loadFirmware]);

  // Reload when the file is rebuilt on disk.
  useEffect(() => {
    if (!fs.firmwarePath || busy) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const info = await invoke<FirmwareInfo>("parse_firmware_cached", { filePath: fs.firmwarePath, baseAddress: null });
        if (cancelled) return;
        const sig = `${info.checksum}:${info.size}`;
        if (lastSignature.current !== null && lastSignature.current !== sig) {
          fs.setFirmwareSelection(fs.firmwarePath, info);
          setOutcome(null);
          setWritten([]);
          addLog(t("firmwareReloaded", { name: info.filename }), "info", "firmware-reload");
        }
        lastSignature.current = sig;
      } catch {
        // The file may be mid-write while the build runs.
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fs.firmwarePath, busy, addLog, fs, t]);

  /* ---------- Port hand-off ---------- */
  const connectOptions = {
    autoReset: fs.dtrRtsEnabled,
    dtrRts: { rtsFunction: fs.rtsFunc, rtsActiveLevel: fs.rtsLevel, dtrFunction: fs.dtrFunc, dtrActiveLevel: fs.dtrLevel },
  };

  /** Closes the monitor's port so the flasher can use it. Returns the config to reopen afterwards. */
  const releasePort = useCallback(async (): Promise<SerialConfig | null> => {
    const wasOpen = isConnected || appState === "MONITORING";
    if (!wasOpen) return null;
    try {
      await invoke("close_port");
    } catch {
      // already closed
    }
    setConnected(null);
    return { ...serialConfig };
  }, [isConnected, appState, serialConfig, setConnected]);

  const resumeMonitor = useCallback(
    async (config: SerialConfig | null) => {
      if (!config || !autoResumeMonitor || !(fs.runAfter || isStc)) {
        setState("IDLE");
        return;
      }
      setState("RESUMING_MONITOR");
      try {
        await invoke("open_port", { config });
        setConnected(config.port_name);
        monitorBuffer.resetDecoder();
        monitorBuffer.appendLine("system", t("monitorResumed", { port: config.port_name }));
        if (autoNavigateMonitorAfterFlash) setActivePage("monitor");
        setState("MONITORING");
      } catch (e) {
        addLog(t("monitorResumeFailed", { error: extractError(e) }), "warn");
        setState("IDLE");
      }
    },
    [autoResumeMonitor, fs.runAfter, isStc, autoNavigateMonitorAfterFlash, addLog, setConnected, setActivePage, setState, t]
  );

  /* ---------- Running an operation ---------- */
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const firmwareCellsRef = useRef(firmwareCells);
  firmwareCellsRef.current = firmwareCells;

  const run = useCallback(
    async (opKind: Operation, task: () => Promise<void>, opSteps: Step[]) => {
      const startedAt = Date.now();
      setOp(opKind);
      setOutcome(null);
      setLog([]);
      logId.current = 0;
      setProgress(null);
      setSteps(opSteps);
      setWritten([]);
      setActiveCell(-1);
      setWriteRate(null);

      const unlistenChip = await listen<ChipInfoResult>("flash-chip", (e) => setChipInfo(e.payload));
      const unlisten = await listen<FlashProgress>("flash-progress", (e) => {
        const p = e.payload;
        // Raw tool output goes to the log only.
        if (p.stage === "log" || p.stage === "log-warn") {
          addLog(p.message, p.stage === "log-warn" ? "warn" : "info");
          return;
        }
        setProgress(p);
        if (p.message) addLog(p.message, "info", replaceKeyFor(p.stage));

        const stepId = stepForStage(p.stage, kind);
        if (stepId) setSteps((prev) => advanceSteps(prev, stepId, Date.now()));

        const geo = geometryRef.current;
        if (!geo) return;
        if (p.address !== undefined && p.length !== undefined) {
          setActiveCell(cellOf(geo, p.address));
          if (p.stage === "writing") {
            setWritten((prev) => {
              const next = prev.length === geo.cells ? prev.slice() : new Array<number>(geo.cells).fill(0);
              forEachCellSpan(geo, p.address!, p.length!, (cell, n) => (next[cell] += n));
              return next;
            });
            setWriteRate((r) => ({ start: r?.start ?? Date.now(), bytes: (r?.bytes ?? 0) + p.length! }));
          }
        } else if (p.stage === "writing" && isAvr && p.percent <= 100) {
          // avrdude only reports a percentage; fill the firmware pages in order.
          const fw = firmwareCellsRef.current;
          if (!fw) return;
          const total = fw.reduce((a, b) => a + b, 0);
          let budget = (total * p.percent) / 100;
          const next = fw.map((n) => {
            const take = Math.min(n, budget);
            budget -= take;
            return take;
          });
          setWritten(next);
          setActiveCell(next.findIndex((n, i) => fw[i] > 0 && n < fw[i]));
        }
      });

      const resumeConfig = await releasePort();
      setState("FLASHING");
      try {
        await task();
        const seconds = (Date.now() - startedAt) / 1000;
        setSteps((prev) => finishSteps(prev, Date.now()));
        setActiveCell(-1);
        setOutcome({ kind: "success", seconds });
        if (opKind === "flash") {
          await resumeMonitor(resumeConfig);
        } else {
          setState("IDLE");
        }
      } catch (e) {
        const message = extractError(e);
        const cancelled = /cancel/i.test(message);
        setSteps((prev) => failSteps(prev, Date.now()));
        setActiveCell(-1);
        setOutcome({ kind: cancelled ? "cancelled" : "error", message });
        addLog(message, cancelled ? "warn" : "error");
        setState(cancelled ? "IDLE" : "FLASH_ERROR");
      } finally {
        unlisten();
        unlistenChip();
        setOp(null);
        if (useAppStore.getState().appState === "FLASHING") setState("IDLE");
      }
    },
    [addLog, isAvr, kind, releasePort, resumeMonitor, setState]
  );

  const startFlash = () => {
    if (!fs.firmwarePath || !portName || !firmware) return;
    void run(
      "flash",
      () =>
        invoke("module_flash", {
          firmwarePath: fs.firmwarePath,
          portName,
          request: isAvr
            ? {
                module: "arduino-avr",
                options: { programmer: fs.avrProgrammer, chip: fs.avrChip, verify: fs.verify, runAfter: fs.runAfter },
              }
            : isStc
              ? {
                  module: "stc89-stcgal",
                  options: {
                    chip: fs.stcChip,
                    powerPin: fs.stcPowerPin,
                    offLevel: fs.stcOffLevel,
                    offMs: fs.stcOffMs,
                    protocol: fs.stcProtocol,
                    transferBaud: fs.stcBaud,
                  },
                }
              : {
                  module: "stm32-isp",
                  baudRate,
                  options: { verify: fs.verify, runAfter: fs.runAfter, autoReset: fs.dtrRtsEnabled, dtrRts: connectOptions.dtrRts },
                },
        }),
      buildSteps(kind, fs.verify, fs.runAfter)
    );
  };

  const detectChip = () => {
    if (!portName) return;
    void run(
      "detect",
      async () => {
        const info = await invoke<ChipInfoResult>("read_chip_info", { portName, baudRate, options: connectOptions });
        setChipInfo(info);
        if (info.chip_match) {
          fs.setFlashReadAddress(hex32(info.chip_match.flash_start));
          fs.setFlashReadSize(`0x${(info.chip_match.flash_kb * 1024).toString(16).toUpperCase()}`);
        }
      },
      [
        { id: "connect", status: "pending" },
        { id: "detect", status: "pending" },
      ]
    );
  };

  const eraseChip = async () => {
    if (!portName) return;
    const name = chipInfo?.chip_match?.name ?? t("chipUnknownShort");
    const ok = await ask(t("eraseConfirm", { chip: name }), { title: t("eraseAll"), kind: "warning", okLabel: t("eraseAll") });
    if (!ok) return;
    void run("erase", async () => void (await invoke("erase_chip", { portName, baudRate, options: connectOptions })), [
      { id: "connect", status: "pending" },
      { id: "detect", status: "pending" },
      { id: "erase", status: "pending" },
    ]);
  };

  const readFlash = async () => {
    const m = chipInfo?.chip_match;
    if (!portName || !m) return;
    const startAddress = parseHexInput(fs.flashReadAddress);
    const size = parseHexInput(fs.flashReadSize);
    const flashEnd = m.flash_start + m.flash_kb * 1024;
    let problem: string | null = null;
    if (startAddress === null || size === null || size <= 0) problem = t("readRangeInvalid");
    else if (startAddress % 4 !== 0) problem = t("readRangeAlign");
    else if (startAddress < m.flash_start || startAddress + size > flashEnd)
      problem = t("readRangeOutside", { from: hex32(m.flash_start), to: hex32(flashEnd - 1) });
    if (problem) {
      setOutcome({ kind: "error", message: problem });
      return;
    }
    const savePath = await save({
      defaultPath: `${m.name}_${startAddress!.toString(16).toUpperCase()}_${size!.toString(16).toUpperCase()}.bin`,
      filters: [{ name: "BIN", extensions: ["bin"] }],
    });
    if (!savePath) return;
    void run(
      "read",
      async () => {
        await invoke("read_flash", { portName, baudRate, options: connectOptions, startAddress, size, savePath });
        addLog(t("readSaved", { path: savePath }), "ok");
      },
      [
        { id: "connect", status: "pending" },
        { id: "verify", status: "pending" },
      ]
    );
  };

  const cancel = async () => {
    try {
      await invoke("cancel_flash");
      addLog(t("cancelling"), "warn");
    } catch (e) {
      addLog(t("cancelFailed", { error: extractError(e) }), "warn");
    }
  };

  /* ---------- Derived display ---------- */
  const currentStep = steps.find((s) => s.status === "current");
  const eta = (() => {
    if (!writeRate || currentStep?.id !== "write" || !firmware) return null;
    const elapsed = (now - writeRate.start) / 1000;
    if (elapsed < 0.5 || writeRate.bytes === 0) return null;
    const remaining = Math.max(0, firmware.size - writeRate.bytes);
    return Math.ceil(remaining / (writeRate.bytes / elapsed));
  })();

  const toolsMissing = Boolean(moduleEnv && !moduleEnv.ready && module && module.required_tools.length > 0);
  const canFlash = Boolean(fs.firmwarePath && firmware && portName && !busy && (!manualChip || manualChipInfo));
  const chip = chipInfo?.chip_match;
  const moduleLabels: Record<string, string> = {
    "stm32-isp": t("moduleStm32Isp"),
    "arduino-avr": t("moduleArduinoAvr"),
    "stc89-stcgal": t("moduleStc89"),
  };
  const moduleOptions =
    modules.length > 0
      ? modules.filter((m) => m.availability === "available").map((m) => ({ value: m.id, label: moduleLabels[m.id] ?? m.name }))
      : [{ value: fs.flashModule, label: moduleLabels[fs.flashModule] ?? fs.flashModule }];
  const chipOptions = (module?.chips ?? []).map((c) => ({ value: c.id, label: c.name, hint: `${c.flash_kb} KB` }));

  const pinOptions = [
    { value: "none:low", label: t("pinUnused") },
    { value: "reset:low", label: t("pinResetLow") },
    { value: "reset:high", label: t("pinResetHigh") },
    { value: "bootloader:high", label: t("pinBootHigh") },
    { value: "bootloader:low", label: t("pinBootLow") },
  ];
  const pinValue = (func: string, level: string) => (func === "none" ? "none:low" : `${func}:${level}`);
  const setPin = (which: "rts" | "dtr", v: string) => {
    const [func, level] = v.split(":");
    if (which === "rts") {
      fs.setRtsFunc(func);
      fs.setRtsLevel(level);
    } else {
      fs.setDtrFunc(func);
      fs.setDtrLevel(level);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(300px,340px)_1fr] h-full min-h-0">
      {/* ---------------- Setup ---------------- */}
      <aside className="flex flex-col min-h-0 border-r border-line">
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-[18px] space-y-[18px]">
          <button
            type="button"
            onClick={pickFirmware}
            disabled={busy}
            className={clsx(
              "w-full grid grid-cols-[36px_1fr] gap-x-3 gap-y-0.5 items-center p-3.5 rounded-lg border border-dashed text-left transition-colors",
              dragOver ? "border-accent bg-accent/10" : "border-line-strong hover:border-ink-3",
              "disabled:opacity-60"
            )}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.6" className="row-span-2 text-accent" aria-hidden>
              <path d="M7 3.5h9l5 5v16H7z" />
              <path d="M16 3.5v5h5" />
              {firmware ? <path d="M11 17h6M11 20.5h4" /> : <path d="M14 13v8M10.5 16.5L14 13l3.5 3.5" />}
            </svg>
            {firmware ? (
              <>
                <span className="font-mono text-md font-semibold truncate">{firmware.filename}</span>
                <span className="text-xs text-ink-3 truncate">
                  {t("firmwareMeta", {
                    format: firmware.format.toUpperCase(),
                    size: formatSize(firmware.size),
                    start: hex32(Math.min(...firmware.segments.map((s) => s.address))),
                  })}
                </span>
              </>
            ) : (
              <>
                <span className="text-md font-semibold">{dragOver ? t("dropToLoad") : t("chooseFirmware")}</span>
                <span className="text-xs text-ink-3">{t("chooseFirmwareHint")}</span>
              </>
            )}
          </button>

          <FieldGroup title={t("groupMethod")}>
            <FieldRow label={t("method")}>
              <Select
                aria-label={t("method")}
                value={fs.flashModule}
                onChange={(v) => {
                  fs.setFlashModule(v);
                  setChipInfo(null);
                  setOutcome(null);
                  setSteps([]);
                  setWritten([]);
                }}
                disabled={busy}
                options={moduleOptions}
                className="w-[176px]"
              />
            </FieldRow>
            {toolsMissing && (
              <div className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-ink-2">
                <span className="flex-1">{t("moduleToolsMissing", { tools: moduleEnv!.missing_tools.join(", ") })}</span>
                <Button size="sm" variant="ghost" onClick={() => setActivePage("modules")}>
                  {t("moduleToolsOpen")}
                </Button>
              </div>
            )}
            {manualChip ? (
              <>
                <FieldRow label={t("chip")} hint={isStc ? t("stcChipHint") : undefined}>
                  <Select
                    aria-label={t("chip")}
                    value={selectedChipId ?? ""}
                    onChange={(v) => (isAvr ? fs.setAvrChip(v) : fs.setStc({ stcChip: v }))}
                    disabled={busy}
                    options={chipOptions}
                    className="w-[176px]"
                    mono
                  />
                </FieldRow>
                {isAvr && (
                  <FieldRow label={t("programmer")}>
                    <Select
                      aria-label={t("programmer")}
                      value={fs.avrProgrammer}
                      onChange={fs.setAvrProgrammer}
                      disabled={busy}
                      options={AVR_PROGRAMMERS}
                      className="w-[176px]"
                    />
                  </FieldRow>
                )}
              </>
            ) : (
              <FieldRow label={t("chip")} hint={chip ? undefined : t("chipAutoHint")}>
                <Button size="sm" onClick={detectChip} disabled={busy || !portName}>
                  {chip ? chip.name : t("detectChip")}
                </Button>
              </FieldRow>
            )}
          </FieldGroup>

          {isStc && (
            <FieldGroup title={t("groupPower")}>
              <FieldRow
                label={t("stcPowerPin")}
                hint={t("stcPowerHint", { pin: fs.stcPowerPin.toUpperCase(), level: t(fs.stcOffLevel === "low" ? "levelLow" : "levelHigh"), ms: fs.stcOffMs })}
              >
                <Select
                  aria-label={t("stcPowerPin")}
                  value={`${fs.stcPowerPin}:${fs.stcOffLevel}`}
                  onChange={(v) => {
                    const [stcPowerPin, stcOffLevel] = v.split(":");
                    fs.setStc({ stcPowerPin, stcOffLevel });
                  }}
                  options={[
                    { value: "dtr:low", label: t("stcPinOff", { pin: "DTR", level: t("levelLow") }) },
                    { value: "dtr:high", label: t("stcPinOff", { pin: "DTR", level: t("levelHigh") }) },
                    { value: "rts:low", label: t("stcPinOff", { pin: "RTS", level: t("levelLow") }) },
                    { value: "rts:high", label: t("stcPinOff", { pin: "RTS", level: t("levelHigh") }) },
                  ]}
                  disabled={busy}
                  className="w-[156px]"
                />
              </FieldRow>
              <FieldRow label={t("stcOffTime")} indent>
                <Select
                  aria-label={t("stcOffTime")}
                  value={String(fs.stcOffMs)}
                  onChange={(v) => fs.setStc({ stcOffMs: Number(v) })}
                  options={[200, 300, 500, 800, 1000, 1500, 2000].map((ms) => ({ value: String(ms), label: `${ms} ms` }))}
                  disabled={busy}
                  className="w-[156px]"
                  mono
                />
              </FieldRow>
              <FieldRow label={t("stcProtocol")} indent>
                <Select
                  aria-label={t("stcProtocol")}
                  value={fs.stcProtocol}
                  onChange={(v) => fs.setStc({ stcProtocol: v })}
                  options={[
                    { value: "auto", label: t("stcProtocolAuto") },
                    { value: "stc89", label: t("stcProtocolOld") },
                    { value: "stc89a", label: t("stcProtocolNew") },
                  ]}
                  disabled={busy}
                  className="w-[156px]"
                />
              </FieldRow>
              <FieldRow label={t("stcBaud")} indent>
                <Select
                  aria-label={t("stcBaud")}
                  value={String(fs.stcBaud)}
                  onChange={(v) => fs.setStc({ stcBaud: Number(v) })}
                  options={[9600, 19200, 38400, 57600, 115200].map((b) => ({ value: String(b), label: String(b) }))}
                  disabled={busy}
                  className="w-[156px]"
                  mono
                />
              </FieldRow>
            </FieldGroup>
          )}

          {kind === "stm32" && (
            <FieldGroup title={t("groupBootloader")}>
              <FieldRow label={t("autoReset")} hint={fs.dtrRtsEnabled ? undefined : t("autoResetOffHint")}>
                <Switch aria-label={t("autoReset")} checked={fs.dtrRtsEnabled} onChange={fs.setDtrRtsEnabled} disabled={busy} />
              </FieldRow>
              {fs.dtrRtsEnabled && (
                <>
                  <FieldRow label={t("rtsPin")} indent>
                    <Select aria-label={t("rtsPin")} value={pinValue(fs.rtsFunc, fs.rtsLevel)} onChange={(v) => setPin("rts", v)} options={pinOptions} disabled={busy} className="w-[156px]" />
                  </FieldRow>
                  <FieldRow label={t("dtrPin")} indent>
                    <Select aria-label={t("dtrPin")} value={pinValue(fs.dtrFunc, fs.dtrLevel)} onChange={(v) => setPin("dtr", v)} options={pinOptions} disabled={busy} className="w-[156px]" />
                  </FieldRow>
                </>
              )}
            </FieldGroup>
          )}

          <FieldGroup title={t("groupAfter")}>
            {!isStc && (
              <>
                <FieldRow label={t("verifyAfterFlash")}>
                  <Switch aria-label={t("verifyAfterFlash")} checked={fs.verify} onChange={fs.setVerify} disabled={busy} />
                </FieldRow>
                <FieldRow label={t("runAfter")}>
                  <Switch aria-label={t("runAfter")} checked={fs.runAfter} onChange={fs.setRunAfter} disabled={busy} />
                </FieldRow>
              </>
            )}
            <FieldRow label={t("autoResumeMonitor")} hint={fs.runAfter || isStc ? undefined : t("resumeNeedsRun")}>
              <Switch aria-label={t("autoResumeMonitor")} checked={autoResumeMonitor && (fs.runAfter || isStc)} onChange={setAutoResumeMonitor} disabled={busy || !(fs.runAfter || isStc)} />
            </FieldRow>
          </FieldGroup>

          {kind === "stm32" && (
            <FieldGroup title={t("groupTools")}>
              <FieldRow label={t("readFlash")} hint={chip ? undefined : t("readNeedsChip")}>
                <Button size="sm" onClick={readFlash} disabled={busy || !chip}>
                  {t("readFlashAction")}
                </Button>
              </FieldRow>
              {chip && (
                <div className="flex items-center gap-2 pl-5 pb-1">
                  <HexInput label={t("readFrom")} value={fs.flashReadAddress} onChange={fs.setFlashReadAddress} disabled={busy} />
                  <HexInput label={t("readLength")} value={fs.flashReadSize} onChange={fs.setFlashReadSize} disabled={busy} />
                </div>
              )}
              <FieldRow label={t("eraseAll")}>
                <Button size="sm" variant="danger" onClick={eraseChip} disabled={busy || !portName}>
                  {t("eraseAction")}
                </Button>
              </FieldRow>
            </FieldGroup>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-line">
          {busy ? (
            <Button variant="danger" size="md" className="w-full" onClick={cancel}>
              {t("cancelFlash")}
            </Button>
          ) : (
            <Button variant="primary" size="md" className="w-full" onClick={startFlash} disabled={!canFlash}>
              {t("startFlash")}
            </Button>
          )}
          {!busy && !canFlash && (
            <p className="mt-2 text-xs text-ink-3 text-center">{!firmware ? t("needFirmware") : t("needPort")}</p>
          )}
        </div>
      </aside>

      {/* ---------------- Run ---------------- */}
      <section className="flex flex-col min-w-0 min-h-0">
        <header className="px-6 pt-[18px] pb-1 flex items-baseline gap-3.5 flex-wrap">
          <h2 className="m-0 font-mono text-xl font-semibold tracking-[-0.01em]">
            {manualChip ? manualChipInfo?.name : chip ? chip.name : chipInfo ? chipInfo.device_id_hex : t("chipNotDetected")}
          </h2>
          <p className="m-0 text-sm text-ink-3">
            {manualChip && manualChipInfo
              ? t("chipSpecs", { flash: manualChipInfo.flash_kb, ram: manualChipInfo.ram_kb })
              : chip
                ? t("chipSpecsBoot", {
                    flash: chip.flash_kb,
                    ram: chip.ram_kb,
                    boot: `${chipInfo!.bootloader_version >> 4}.${chipInfo!.bootloader_version & 0xf}`,
                  })
                : chipInfo
                  ? t("chipUnknown")
                  : t("chipNotDetectedHint")}
          </p>
        </header>

        <StatusLine
          op={op}
          step={currentStep}
          progress={progress}
          outcome={outcome}
          eta={eta}
          firmwareLoaded={Boolean(firmware)}
        />

        <div className="px-6 pt-3.5 pb-3.5">
          {geometry ? (
            <PageMap geometry={geometry} firmware={firmwareCells} written={written} activeCell={activeCell} />
          ) : (
            <p className="py-6 text-sm text-ink-3">{t("mapEmpty")}</p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-line px-6 py-2.5">
          {steps.length > 0 ? (
            <ol className="list-none m-0 p-0">
              {steps.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  now={now}
                  label={stepLabel(t, s.id, { isAvr, isStc, writtenPages, firmwarePages, resume: autoResumeMonitor && Boolean(isConnected || op) })}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-3 leading-[26px]">{firmware ? t(isStc ? "readyHintStc" : "readyHint") : t("idleHint")}</p>
          )}

          {log.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowLog(!showLog)} className="text-xs text-ink-3 hover:text-ink-2">
                {showLog ? t("hideLog") : t("showLog", { count: log.length })}
              </button>
              {showLog && (
                <div className="mt-1.5 max-h-48 overflow-auto rounded border border-line bg-chrome px-3 py-2 font-mono text-xs leading-5 select-text">
                  {log.map((l) => (
                    <div key={l.id} className={clsx({ "text-ink-2": l.tone === "info", "text-ok": l.tone === "ok", "text-warn": l.tone === "warn", "text-err": l.tone === "error" })}>
                      {l.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

function HexInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const invalid = value.trim() !== "" && parseHexInput(value) === null;
  return (
    <label className="flex-1 min-w-0">
      <span className="block text-2xs text-ink-3 mb-0.5">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={invalid}
        className={clsx(
          "w-full h-7 px-2 rounded border bg-base font-mono text-xs text-ink focus:outline-none",
          invalid ? "border-err" : "border-line focus:border-accent"
        )}
      />
    </label>
  );
}

type TFn = ReturnType<typeof useTranslation>["t"];

function stepLabel(
  t: TFn,
  id: Step["id"],
  ctx: { isAvr: boolean; isStc: boolean; writtenPages: number; firmwarePages: number; resume: boolean }
): string {
  switch (id) {
    case "connect":
      return ctx.isAvr ? t("stepConnectAvr") : ctx.isStc ? t("stepConnectStc") : t("stepConnect");
    case "detect":
      return t("stepDetect");
    case "erase":
      return t("stepErase");
    case "write":
      return ctx.firmwarePages > 0 ? t("stepWritePages", { done: ctx.writtenPages, total: ctx.firmwarePages }) : t("stepWrite");
    case "verify":
      return t("stepVerify");
    case "run":
      return ctx.resume ? t("stepRunResume") : t("stepRun");
  }
}

function StepRow({ step, label, now }: { step: Step; label: string; now: number }) {
  const seconds =
    step.startedAt !== undefined ? ((step.endedAt ?? (step.status === "current" ? now : step.startedAt)) - step.startedAt) / 1000 : null;
  return (
    <li
      className={clsx(
        "grid grid-cols-[22px_1fr_auto] items-center leading-[26px] text-sm",
        step.status === "current" && "font-semibold",
        step.status === "pending" && "text-ink-3",
        step.status === "failed" && "text-err"
      )}
    >
      {step.status === "done" ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-ok" aria-hidden><path d="M2.5 7.5l3 3 6-7" /></svg>
      ) : step.status === "current" ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-accent" aria-hidden><circle cx="7" cy="7" r="3.5" /></svg>
      ) : step.status === "failed" ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="7" cy="7" r="3.5" /></svg>
      )}
      <span>{label}</span>
      <span className="font-mono text-xs font-normal text-ink-3 tabular-nums">{seconds !== null ? `${seconds.toFixed(2)} s` : ""}</span>
    </li>
  );
}

function StatusLine({
  op,
  step,
  progress,
  outcome,
  eta,
  firmwareLoaded,
}: {
  op: Operation | null;
  step: Step | undefined;
  progress: FlashProgress | null;
  outcome: Outcome;
  eta: number | null;
  firmwareLoaded: boolean;
}) {
  const { t } = useTranslation("flash");

  if (op) {
    const now = step ? t(`now_${step.id}`) : t("now_connect");
    return (
      <div className="px-6 pt-2.5 flex items-baseline gap-2.5" aria-live="polite">
        <span className="text-lg font-semibold">{now}</span>
        {progress?.address !== undefined && <span className="font-mono text-sm text-ink-2">{hex32(progress.address)}</span>}
        <span className="ml-auto text-sm text-ink-3">{eta !== null ? t("etaSeconds", { count: eta }) : ""}</span>
        <span className="font-mono text-lg font-semibold text-accent tabular-nums">{progress ? `${Math.min(100, progress.percent)}%` : ""}</span>
      </div>
    );
  }

  if (outcome) {
    const tone = outcome.kind === "success" ? "text-ok" : outcome.kind === "cancelled" ? "text-warn" : "text-err";
    return (
      <div className="px-6 pt-2.5" role="status">
        <p className={clsx("m-0 text-lg font-semibold", tone)}>
          {outcome.kind === "success"
            ? t("doneIn", { seconds: (outcome.seconds ?? 0).toFixed(1) })
            : outcome.kind === "cancelled"
              ? t("cancelled")
              : t("failed")}
        </p>
        {outcome.kind === "error" && outcome.message && (
          <p className="m-0 mt-1 text-sm text-ink-2 select-text">{outcome.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-6 pt-2.5">
      <p className="m-0 text-lg font-semibold text-ink-2">{firmwareLoaded ? t("ready") : t("waitingFirmware")}</p>
    </div>
  );
}
