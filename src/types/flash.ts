export type AppState =
  | "STARTING"
  | "IDLE"
  | "MONITORING"
  | "PORT_LOST"
  | "READY_TO_FLASH"
  | "FLASHING"
  | "FLASH_ERROR"
  | "RESUMING_MONITOR";

export interface AppStateContext {
  state: AppState;
  previousState: AppState | null;
  activePort: string | null;
  flashModule: string | null;
}
