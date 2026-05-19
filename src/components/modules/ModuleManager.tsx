import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Boxes, Wrench, CircleCheck, CircleAlert, Clock3, RefreshCw, Cpu, FileCode2, Info, Download } from "lucide-react";
import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";

interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  installed: boolean;
  chip_count: number;
  format_count: number;
  status: string;
  required_tools: string[];
}

interface EnvStatus {
  ready: boolean;
  missing_tools: string[];
  messages: string[];
  version?: string | null;
  install_hint?: string | null;
  install_steps: string[];
  references: { label: string; url: string }[];
}

function statusTone(status: string, ready: boolean | undefined) {
  if (status === "planned") {
    return {
      icon: <Clock3 size={13} className="text-text-muted" />,
      className: "bg-surface border-border text-text-muted",
    };
  }
  if (ready) {
    return {
      icon: <CircleCheck size={13} className="text-green-600 dark:text-green-400" />,
      className: "bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400",
    };
  }
  return {
    icon: <CircleAlert size={13} className="text-yellow-600 dark:text-yellow-400" />,
    className: "bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-300",
  };
}

export function ModuleManager() {
  const { t } = useTranslation(["settings", "common"]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [envByModule, setEnvByModule] = useState<Record<string, EnvStatus>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [selectedModule, setSelectedModule] = useState<ModuleInfo | null>(null);
  const [installingModule, setInstallingModule] = useState<ModuleInfo | null>(null);

  const refreshModules = async () => {
    setRefreshing(true);
    try {
      const moduleList = await invoke<ModuleInfo[]>("list_modules");
      setModules(moduleList);

      const envEntries = await Promise.all(
        moduleList.map(async (module) => {
          try {
            const env = await invoke<EnvStatus>("check_module_env", { moduleId: module.id });
            return [module.id, env] as const;
          } catch {
            return [
              module.id,
              {
                ready: false,
                missing_tools: [],
                messages: [t("moduleEnvCheckFailed", { ns: "settings", defaultValue: "Environment check failed." })],
                version: null,
                install_hint: null,
                install_steps: [],
                references: [],
              },
            ] as const;
          }
        })
      );
      setEnvByModule(Object.fromEntries(envEntries));
    } catch {
      setModules([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshModules();
  }, []);

  const selectedEnv = useMemo(
    () => (selectedModule ? envByModule[selectedModule.id] : undefined),
    [selectedModule, envByModule]
  );

  const statusLabel = (module: ModuleInfo, env: EnvStatus | undefined) => {
    if (module.status === "planned") return t("moduleStatusPlanned", { ns: "settings" });
    if (env?.ready) return t("moduleStatusReady", { ns: "settings" });
    if (env?.missing_tools?.length) return t("moduleStatusMissingTools", { ns: "settings" });
    return t("moduleStatusUnknown", { ns: "settings" });
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-border bg-surface-alt/50">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
          <Boxes size={14} className="text-accent" />
          {t("moduleManagement", { ns: "settings" })}
        </h2>
        <button
          onClick={() => void refreshModules()}
          className="h-7 px-2.5 text-[0.6875rem] rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={12} className={clsx(refreshing && "animate-spin")} />
          {t("refresh", { ns: "common" })}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {modules.map((module) => {
          const env = envByModule[module.id];
          const tone = statusTone(module.status, env?.ready);

          return (
            <div key={module.id} className="rounded-lg border border-border bg-surface-alt/30 overflow-hidden">
              <div className="p-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Wrench size={13} className="text-text-muted mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[0.6875rem] text-text-secondary font-medium">{module.name}</span>
                      <span className="text-[0.5625rem] text-text-muted uppercase tracking-wide">
                        {module.builtin ? t("builtinModule", { ns: "settings" }) : t("optionalModule", { ns: "settings" })}
                      </span>
                    </div>
                    <p className="text-[0.625rem] text-text-muted mt-0.5 leading-relaxed">{module.description}</p>
                  </div>
                </div>
                <div className={clsx("inline-flex items-center gap-1.5 px-2 py-1 rounded text-[0.625rem] shrink-0", tone.className)}>
                  {tone.icon}
                  <span>{statusLabel(module, env)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border bg-surface-alt/40 text-[0.625rem] text-text-muted flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Cpu size={12} />
                    {module.chip_count} {t("moduleChips", { ns: "settings" })}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FileCode2 size={12} />
                    {module.format_count} {t("moduleFormats", { ns: "settings" })}
                  </span>
                  {module.required_tools.length > 0 && (
                    <span>{t("needTools", { ns: "settings", tools: module.required_tools.join(", ") })}</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedModule(module)}
                    className="h-7 px-2.5 rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-1.5"
                  >
                    <Info size={12} />
                    {t("details", { ns: "settings" })}
                  </button>
                  {!env?.ready && (
                    <button
                      onClick={() => setInstallingModule(module)}
                      className="h-7 px-2.5 rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-1.5"
                    >
                      <Download size={12} />
                      {t("install", { ns: "settings" })}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {modules.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-alt/30 p-4 text-[0.6875rem] text-text-muted">
            {t("moduleEmpty", { ns: "settings" })}
          </div>
        )}
      </div>

      <Dialog.Root open={selectedModule !== null} onOpenChange={(open) => !open && setSelectedModule(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface shadow-xl">
            {selectedModule && (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-alt/50">
                  <Dialog.Title className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
                    <Boxes size={14} className="text-accent" />
                    {selectedModule.name}
                  </Dialog.Title>
                  <Dialog.Close className="h-7 px-2.5 rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover transition-colors">
                    {t("close", { ns: "common" })}
                  </Dialog.Close>
                </div>

                <div className="p-4 space-y-4 text-[0.6875rem]">
                  <div className="space-y-1">
                    <p className="text-text-secondary font-medium">{selectedModule.description}</p>
                    <p className="text-text-muted">
                      {selectedModule.builtin ? t("builtinModule", { ns: "settings" }) : t("optionalModule", { ns: "settings" })}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                    <p className="text-text-secondary font-medium">{t("moduleStatus", { ns: "settings" })}</p>
                    <p className="text-text-muted">
                      {statusLabel(selectedModule, selectedEnv)}
                    </p>
                    <p className="text-text-muted">
                      {selectedEnv?.version
                        ? `${t("version", { ns: "settings" })}: ${selectedEnv.version}`
                        : `${t("version", { ns: "settings" })}: -`}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                    <p className="text-text-secondary font-medium">{t("install", { ns: "settings" })}</p>
                    <p className="text-text-muted leading-relaxed">
                      {selectedEnv?.install_hint || t("moduleNoInstallHint", { ns: "settings" })}
                    </p>
                    {selectedEnv?.install_steps?.length ? (
                      <ol className="space-y-1 pl-4 text-text-muted">
                        {selectedEnv.install_steps.map((step, index) => (
                          <li key={index} className="leading-relaxed list-decimal">{step}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>

                  {selectedEnv?.messages?.length ? (
                    <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                      <p className="text-text-secondary font-medium">{t("moduleNotes", { ns: "settings" })}</p>
                      {selectedEnv.messages.map((message, index) => (
                        <p key={index} className="text-text-muted leading-relaxed">{message}</p>
                      ))}
                    </div>
                  ) : null}

                  {selectedEnv?.references?.length ? (
                    <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                      <p className="text-text-secondary font-medium">{t("moduleReferences", { ns: "settings" })}</p>
                      <div className="space-y-1">
                        {selectedEnv.references.map((ref, index) => (
                          <p key={index} className="text-text-muted leading-relaxed">
                            <a className="text-accent hover:underline" href={ref.url} target="_blank" rel="noreferrer">
                              {ref.label}
                            </a>
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={installingModule !== null} onOpenChange={(open) => !open && setInstallingModule(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface shadow-xl">
            {installingModule && (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-alt/50">
                  <Dialog.Title className="text-xs font-semibold text-text-primary tracking-wide flex items-center gap-2">
                    <Download size={14} className="text-accent" />
                    {t("install", { ns: "settings" })} · {installingModule.name}
                  </Dialog.Title>
                  <Dialog.Close className="h-7 px-2.5 rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover transition-colors">
                    {t("close", { ns: "common" })}
                  </Dialog.Close>
                </div>

                <div className="p-4 space-y-3 text-[0.6875rem]">
                  <p className="text-text-secondary font-medium">
                    {t("moduleInstallPending", {
                      ns: "settings",
                      defaultValue: "This module is not fully integrated yet. Use the guidance below to prepare the environment first.",
                    })}
                  </p>

                  <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                    <p className="text-text-secondary font-medium">{t("install", { ns: "settings" })}</p>
                    <p className="text-text-muted leading-relaxed">
                      {envByModule[installingModule.id]?.install_hint || t("moduleNoInstallHint", { ns: "settings" })}
                    </p>
                    {envByModule[installingModule.id]?.install_steps?.length ? (
                      <ol className="space-y-1 pl-4 text-text-muted">
                        {envByModule[installingModule.id]?.install_steps.map((step, index) => (
                          <li key={index} className="leading-relaxed list-decimal">{step}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>

                  {envByModule[installingModule.id]?.references?.length ? (
                    <div className="rounded-lg border border-border bg-surface-alt/30 p-3 space-y-1.5">
                      <p className="text-text-secondary font-medium">{t("moduleReferences", { ns: "settings" })}</p>
                      <div className="space-y-1">
                        {envByModule[installingModule.id]?.references.map((ref, index) => (
                          <p key={index} className="text-text-muted leading-relaxed">
                            <a className="text-accent hover:underline" href={ref.url} target="_blank" rel="noreferrer">
                              {ref.label}
                            </a>
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
