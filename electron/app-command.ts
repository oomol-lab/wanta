export const APP_COMMAND_CHANNEL = "wanta:app-command"

export const APP_COMMANDS = {
  checkForUpdates: "update.check",
  openConnections: "connections.open",
  focusComposer: "chat.focusComposer",
  newChat: "chat.new",
  openSearch: "sessions.search",
  openSettings: "settings.open",
  stopGeneration: "chat.stopGeneration",
  toggleSidebar: "sidebar.toggle",
} as const

export type AppCommand = (typeof APP_COMMANDS)[keyof typeof APP_COMMANDS]

const appCommandValues = new Set<string>(Object.values(APP_COMMANDS))

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === "string" && appCommandValues.has(value)
}
