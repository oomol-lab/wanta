import { ConnectionClient } from "@oomol/connection"
import { ElectronClientAdapter } from "@oomol/connection-electron-adapter/client"
import { createRoot } from "react-dom/client"
import { AuthService } from "../electron/auth/common"
import { ChatService } from "../electron/chat/common"
import { ConnectionsService } from "../electron/connections/common"
import { SessionService } from "../electron/session/common"
import { SettingsService } from "../electron/settings/common"
import { UpdateService } from "../electron/update/common.ts"
import { App } from "@/App"
import { AppContext } from "@/components/AppContext"

import "./index.css"

const rootElement = document.querySelector("#root")
if (!rootElement) {
  throw new Error("Lumo: missing #root mount node")
}

document.documentElement.dataset.platform = globalThis.lumo?.platform ?? "browser"
document.documentElement.dataset.window = "main"

const client = new ConnectionClient(new ElectronClientAdapter())
client.start()

const chatService = client.use(ChatService)
const sessionService = client.use(SessionService)
const connectionsService = client.use(ConnectionsService)
const settingsService = client.use(SettingsService)
const authService = client.use(AuthService)
const updateService = client.use(UpdateService)

createRoot(rootElement).render(
  <AppContext.Provider
    value={{ chatService, sessionService, connectionsService, settingsService, authService, updateService }}
  >
    <App />
  </AppContext.Provider>,
)
