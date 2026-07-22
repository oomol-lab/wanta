import { ConnectionClient } from "@oomol/connection"
import { ElectronClientAdapter } from "@oomol/connection-electron-adapter/client"
import { createRoot } from "react-dom/client"
import { AttentionService } from "../electron/attention/common.ts"
import { AuthService } from "../electron/auth/common.ts"
import { ChatService } from "../electron/chat/common.ts"
import { GitService } from "../electron/git/common.ts"
import { KnowledgeService } from "../electron/knowledge/common.ts"
import { LinkRuntimeService } from "../electron/link-runtime/common.ts"
import { ModelsService } from "../electron/models/common.ts"
import { SessionService } from "../electron/session/common.ts"
import { SettingsService } from "../electron/settings/common.ts"
import { SkillService } from "../electron/skills/common.ts"
import { UpdateService } from "../electron/update/common.ts"
import { App } from "@/App"
import { AppContext } from "@/components/AppContext"
import { detectInitialLocale, translate } from "@/i18n/i18n"
import { reportRendererIssue } from "@/lib/renderer-diagnostics"

import "@univerjs/preset-sheets-core/lib/index.css"
import "./index.css"

const electronConnectionBridgeName = "oomol-connection-electron-bridge"
const rootElement = document.querySelector("#root")
if (!rootElement) {
  throw new Error("Wanta: missing #root mount node")
}

document.documentElement.dataset.platform = globalThis.wanta?.platform ?? "browser"
document.documentElement.dataset.window = "main"
installRendererErrorReporting()

if (!hasElectronConnectionBridge()) {
  const error = new Error("Wanta: missing Electron connection bridge")
  reportRendererIssue("error", "startup.connectionBridge", error.message, error)
  renderStartupError(rootElement)
} else {
  const client = new ConnectionClient(new ElectronClientAdapter())
  client.start()

  const chatService = client.use(ChatService)
  const attentionService = client.use(AttentionService)
  const gitService = client.use(GitService)
  const knowledgeService = client.use(KnowledgeService)
  const linkRuntimeService = client.use(LinkRuntimeService)
  const sessionService = client.use(SessionService)
  const skillService = client.use(SkillService)
  const modelsService = client.use(ModelsService)
  const settingsService = client.use(SettingsService)
  const authService = client.use(AuthService)
  const updateService = client.use(UpdateService)

  createRoot(rootElement).render(
    <AppContext.Provider
      value={{
        attentionService,
        chatService,
        gitService,
        knowledgeService,
        linkRuntimeService,
        sessionService,
        skillService,
        modelsService,
        settingsService,
        authService,
        updateService,
      }}
    >
      <App />
    </AppContext.Provider>,
  )
}

function hasElectronConnectionBridge(): boolean {
  return Boolean((globalThis as Record<string, unknown>)[electronConnectionBridgeName])
}

function renderStartupError(container: Element): void {
  const locale = detectInitialLocale()
  createRoot(container).render(
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md space-y-4 text-center">
        <div className="space-y-2">
          <h1 className="text-base font-medium">{translate(locale, "app.startupFailedTitle")}</h1>
          <p className="text-sm text-muted-foreground">{translate(locale, "app.startupBridgeMissingDescription")}</p>
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          onClick={() => window.location.reload()}
        >
          {translate(locale, "app.reload")}
        </button>
      </div>
    </main>,
  )
}

function installRendererErrorReporting(): void {
  const report = (source: "error" | "unhandledrejection", cause: unknown): void => {
    reportRendererIssue(source, "global", "renderer global error", cause)
  }
  window.addEventListener("error", (event) => {
    report("error", event.error ?? event.message)
  })
  window.addEventListener("unhandledrejection", (event) => {
    report("unhandledrejection", event.reason)
  })
}
