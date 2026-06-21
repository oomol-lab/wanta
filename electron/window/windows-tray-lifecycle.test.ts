import { describe, expect, it, vi } from "vitest"
import { buildWindowsTrayMenuTemplate } from "./windows-tray-lifecycle.ts"

type TrayMenuClick = () => void

describe("buildWindowsTrayMenuTemplate", () => {
  it("uses English tray labels by default", () => {
    const onOpen = vi.fn()
    const onExit = vi.fn()
    const [openItem, exitItem] = buildWindowsTrayMenuTemplate({ onExit, onOpen })

    expect(openItem?.label).toBe("Open Lumo")
    expect(exitItem?.label).toBe("Exit")

    expect(openItem?.click).toBeTypeOf("function")
    expect(exitItem?.click).toBeTypeOf("function")

    ;(openItem.click as TrayMenuClick)()
    ;(exitItem.click as TrayMenuClick)()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it("uses Chinese tray labels for zh locales", () => {
    const [openItem, exitItem] = buildWindowsTrayMenuTemplate({
      locale: "zh-CN",
      onExit: () => undefined,
      onOpen: () => undefined,
    })

    expect(openItem?.label).toBe("打开 Lumo")
    expect(exitItem?.label).toBe("退出")
  })
})
