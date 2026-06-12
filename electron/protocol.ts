import { app } from "electron"
import path from "node:path"

export interface ProtocolHandler {
  handleUrl(url: string): Promise<boolean> | boolean
}

export function registerProtocolClient(scheme: string): void {
  if (app.isPackaged || process.platform === "darwin") {
    app.setAsDefaultProtocolClient(scheme)
    return
  }

  const mainEntry = process.env["APP_ROOT"]
    ? path.join(process.env["APP_ROOT"], "dist-electron", "main.js")
    : path.resolve(process.argv[1] ?? "dist-electron/main.js")
  app.setAsDefaultProtocolClient(scheme, process.execPath, [mainEntry])
}

export function requestProtocolSingleInstanceLock(
  scheme: string,
  options: { enabled?: boolean } = {},
): {
  isLocked: boolean
  initialUrl?: string
} {
  const initialUrl = process.argv.find((arg) => arg.startsWith(`${scheme}://`))

  if (options.enabled === false) {
    return {
      isLocked: true,
      initialUrl,
    }
  }

  const isLocked = app.requestSingleInstanceLock({ url: initialUrl })

  return {
    isLocked,
    initialUrl,
  }
}

export function listenProtocolUrls(scheme: string, handler: ProtocolHandler, onSecondInstance: () => void): void {
  const dispatchUrl = (url: string): void => {
    void Promise.resolve(handler.handleUrl(url)).catch((error) => {
      console.warn("[protocol] failed to handle protocol url", error)
    })
  }

  app.on("open-url", (event, url) => {
    if (!url.startsWith(`${scheme}://`)) {
      return
    }

    event.preventDefault()
    dispatchUrl(url)
  })

  app.on("second-instance", (_event, _argv, _workingDirectory, additionalData) => {
    const url = (additionalData as { url?: string } | undefined)?.url

    if (url?.startsWith(`${scheme}://`)) {
      dispatchUrl(url)
    }

    onSecondInstance()
  })
}
