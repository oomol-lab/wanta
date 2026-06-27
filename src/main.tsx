import { ConnectionClient } from "@oomol/connection"
import { ElectronClientAdapter } from "@oomol/connection-electron-adapter/client"
import { createRoot } from "react-dom/client"
import { AuthService } from "../electron/auth/common.ts"
import { ChatService } from "../electron/chat/common.ts"
import { GitService } from "../electron/git/common.ts"
import { ModelsService } from "../electron/models/common.ts"
import { SessionService } from "../electron/session/common.ts"
import { SettingsService } from "../electron/settings/common.ts"
import { SkillService } from "../electron/skills/common.ts"
import { UpdateService } from "../electron/update/common.ts"
import { App } from "@/App"
import { AppContext } from "@/components/AppContext"

import "./index.css"

const rootElement = document.querySelector("#root")
if (!rootElement) {
  throw new Error("Wanta: missing #root mount node")
}

document.documentElement.dataset.platform = globalThis.wanta?.platform ?? "browser"
document.documentElement.dataset.window = "main"

const client = new ConnectionClient(new ElectronClientAdapter())
client.start()

const chatService = client.use(ChatService)
const gitService = client.use(GitService)
const sessionService = client.use(SessionService)
const skillService = client.use(SkillService)
const modelsService = client.use(ModelsService)
const settingsService = client.use(SettingsService)
const authService = client.use(AuthService)
const updateService = client.use(UpdateService)

createRoot(rootElement).render(
  <AppContext.Provider
    value={{
      chatService,
      gitService,
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
