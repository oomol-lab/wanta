export type AppEntryState = "app" | "fallback" | "loading"

/** 身份只参与云能力选择，不再决定能否进入应用主界面。 */
export function resolveAppEntryState({
  authReady,
  runtimeReady,
  runtimeFailed,
}: {
  authReady: boolean
  runtimeReady: boolean
  runtimeFailed: boolean
}): AppEntryState {
  if (!authReady || (!runtimeReady && !runtimeFailed)) return "loading"
  return runtimeReady ? "app" : "fallback"
}
