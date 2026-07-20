import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => "1.0.0"),
    isPackaged: true,
  },
  powerMonitor: {
    off: vi.fn(),
    on: vi.fn(),
  },
}))

const updaterMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Set<Listener>>()
  const updater = {
    allowDowngrade: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    off: vi.fn((event: string, listener: Listener) => listeners.get(event)?.delete(listener)),
    on: vi.fn((event: string, listener: Listener) => {
      const current = listeners.get(event) ?? new Set<Listener>()
      current.add(listener)
      listeners.set(event, current)
    }),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  }
  return {
    emit(event: string, ...args: unknown[]): void {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    listeners,
    updater,
  }
})

vi.mock("electron", () => electronMocks)
vi.mock("electron-updater", () => ({ default: { autoUpdater: updaterMocks.updater } }))

import type { PersistedSettings, SettingsStore } from "../settings/store.ts"

import { UpdateServiceImpl } from "./node.ts"

function settingsStore(): SettingsStore {
  let settings: PersistedSettings = { updateChannel: "stable" }
  return {
    read: () => settings,
    write: (next: PersistedSettings) => {
      settings = next
    },
  } as SettingsStore
}

describe("UpdateServiceImpl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updaterMocks.listeners.clear()
    updaterMocks.updater.autoDownload = false
    updaterMocks.updater.autoInstallOnAppQuit = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("checks promptly on foreground and suppresses the overlapping startup check", async () => {
    vi.useFakeTimers()
    updaterMocks.updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: "1.0.0" },
    })
    const service = new UpdateServiceImpl({ store: settingsStore() })

    service.startBackgroundChecks()
    service.handleWindowForegrounded()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(updaterMocks.updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(electronMocks.powerMonitor.on).toHaveBeenCalledWith("resume", expect.any(Function))
    service.dispose()
  })

  it("ignores progress and completion events from a cancelled channel generation", async () => {
    let finishDownload!: () => void
    const cancellationToken = { cancel: vi.fn() }
    updaterMocks.updater.checkForUpdates.mockResolvedValue({
      cancellationToken,
      isUpdateAvailable: true,
      updateInfo: { version: "2.0.0" },
    })
    updaterMocks.updater.downloadUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve
        }),
    )
    const service = new UpdateServiceImpl({ store: settingsStore() })

    const download = service.downloadAppUpdate()
    await vi.waitFor(() => expect(updaterMocks.updater.downloadUpdate).toHaveBeenCalledOnce())
    updaterMocks.updater.checkForUpdates.mockResolvedValue(null)

    await service.setUpdateChannel("beta")
    updaterMocks.emit("download-progress", { percent: 90 })
    updaterMocks.emit("update-downloaded", { version: "2.0.0" })

    expect(cancellationToken.cancel).toHaveBeenCalledOnce()
    expect((await service.getAppUpdateState()).status.status).not.toBe("downloaded")

    finishDownload()
    await download
    service.dispose()
  })
})
