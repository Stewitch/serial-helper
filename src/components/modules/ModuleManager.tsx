import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { useModulesStore, type ModuleInfo, type EnvStatus } from "@/stores/modulesStore";
import { Button } from "@/components/ui";

interface ModuleEnvUpdate {
  module: ModuleInfo;
  env: EnvStatus;
}

type Tone = "ok" | "warn" | "muted";

function moduleTone(module: ModuleInfo, env: EnvStatus | undefined): Tone {
  if (module.status === "planned") return "muted";
  if (env?.ready) return "ok";
  return env ? "warn" : "muted";
}

export function ModuleManager() {
  const { t } = useTranslation("settings");
  const modules = useModulesStore((s) => s.modules);
  const envByModule = useModulesStore((s) => s.envByModule);
  const refreshing = useModulesStore((s) => s.refreshing);
  const lastLoadedAt = useModulesStore((s) => s.lastLoadedAt);
  const setModulesData = useModulesStore((s) => s.setModulesData);
  const updateModuleEnv = useModulesStore((s) => s.updateModuleEnv);
  const setRefreshing = useModulesStore((s) => s.setRefreshing);
  const [selected, setSelected] = useState<ModuleInfo | null>(null);

  const refreshModules = async () => {
    setRefreshing(true);
    try {
      const list = await invoke<ModuleInfo[]>("list_modules");
      setModulesData(list, {});
      await invoke("start_module_scan");
    } catch {
      setModulesData([], {});
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<ModuleEnvUpdate>("module-env-update", (event) => {
      updateModuleEnv(event.payload.module, event.payload.env);
      setRefreshing(false);
    }).then((fn) => (unlisten = fn));
    if (!lastLoadedAt) void refreshModules();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusText = (module: ModuleInfo, env: EnvStatus | undefined) => {
    if (module.status === "planned") return t("moduleStatusPlanned");
    if (env?.ready) return env.version ? t("moduleReadyVersion", { version: env.version }) : t("moduleStatusReady");
    if (env?.missing_tools?.length) return t("moduleMissing", { tools: env.missing_tools.join("、") });
    return refreshing ? t("moduleChecking") : t("moduleStatusUnknown");
  };

  const selectedEnv = selected ? envByModule[selected.id] : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 py-7">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="m-0 text-xl font-semibold">{t("moduleManagement")}</h1>
          <span className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => void refreshModules()}
            disabled={refreshing}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className={clsx(refreshing && "animate-spin")} aria-hidden>
                <path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 2v2.5H9" />
              </svg>
            }
          >
            {refreshing ? t("moduleChecking") : t("moduleRecheck")}
          </Button>
        </div>
        <p className="m-0 mb-5 text-sm text-ink-3">{t("moduleIntro")}</p>

        {modules.length === 0 ? (
          <p className="py-6 text-sm text-ink-3">{refreshing ? t("moduleChecking") : t("moduleEmpty")}</p>
        ) : (
          <ul className="list-none m-0 p-0 border-y border-line divide-y divide-line">
            {modules.map((module) => {
              const env = envByModule[module.id];
              const tone = moduleTone(module, env);
              return (
                <li key={module.id} className="grid grid-cols-[12px_1fr_auto] gap-x-3.5 items-start py-3.5">
                  <span
                    aria-hidden
                    className={clsx("mt-[7px] w-2 h-2 rounded-full", {
                      "bg-ok": tone === "ok",
                      "bg-warn": tone === "warn",
                      "bg-line-strong": tone === "muted",
                    })}
                  />
                  <div className="min-w-0">
                    <p className="m-0 text-md font-semibold">
                      {module.name}
                      {!module.builtin && <span className="ml-2 text-xs font-normal text-ink-3">{t("optionalModule")}</span>}
                    </p>
                    <p className="m-0 mt-0.5 text-sm text-ink-2">{module.description}</p>
                    <p
                      className={clsx("m-0 mt-1.5 text-xs", {
                        "text-ok": tone === "ok",
                        "text-warn": tone === "warn",
                        "text-ink-3": tone === "muted",
                      })}
                    >
                      {statusText(module, env)}
                      <span className="text-ink-3">　{t("moduleCounts", { chips: module.chip_count, formats: module.format_count })}</span>
                    </p>
                  </div>
                  <Button size="sm" variant={tone === "warn" ? "outline" : "ghost"} onClick={() => setSelected(module)}>
                    {tone === "warn" ? t("moduleSetup") : t("details")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog.Root open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(600px,calc(100vw-48px))] max-h-[calc(100vh-96px)] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg bg-raised text-ink shadow-pop focus:outline-none">
            {selected && (
              <div className="p-6 space-y-5">
                <div>
                  <Dialog.Title className="m-0 text-lg font-semibold">{selected.name}</Dialog.Title>
                  <Dialog.Description className="m-0 mt-1 text-sm text-ink-2">{selected.description}</Dialog.Description>
                  <p className="m-0 mt-2 text-xs text-ink-3">{statusText(selected, selectedEnv)}</p>
                </div>

                {(selectedEnv?.install_hint || selectedEnv?.install_steps?.length) && !selectedEnv?.ready ? (
                  <section>
                    <h3 className="m-0 mb-2 text-xs font-semibold text-ink-3">{t("moduleSetupSteps")}</h3>
                    {selectedEnv?.install_hint && <p className="m-0 mb-2 text-sm text-ink-2">{selectedEnv.install_hint}</p>}
                    {selectedEnv?.install_steps?.length ? (
                      <ol className="m-0 pl-5 space-y-1 text-sm text-ink-2 list-decimal">
                        {selectedEnv.install_steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ) : null}

                {selectedEnv?.messages?.length ? (
                  <section>
                    <h3 className="m-0 mb-2 text-xs font-semibold text-ink-3">{t("moduleNotes")}</h3>
                    {selectedEnv.messages.map((m, i) => (
                      <p key={i} className="m-0 mb-1 text-sm text-ink-2 select-text">
                        {m}
                      </p>
                    ))}
                  </section>
                ) : null}

                {selectedEnv?.references?.length ? (
                  <section>
                    <h3 className="m-0 mb-2 text-xs font-semibold text-ink-3">{t("moduleReferences")}</h3>
                    <ul className="m-0 p-0 list-none space-y-1">
                      {selectedEnv.references.map((ref, i) => (
                        <li key={i}>
                          <a className="text-sm text-accent hover:underline" href={ref.url} target="_blank" rel="noreferrer">
                            {ref.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="flex justify-end">
                  <Dialog.Close asChild>
                    <Button variant="outline" size="md">
                      {t("common:close")}
                    </Button>
                  </Dialog.Close>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
