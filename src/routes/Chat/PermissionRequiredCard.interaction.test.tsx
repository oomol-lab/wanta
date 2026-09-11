import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PermissionRequiredCard } from "./PermissionRequiredCard.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})
const request: ChatPermissionRequest = {
  id: "one",
  sessionId: "session",
  action: "external_directory",
  resources: ["/Users/me/Downloads/reports"],
  save: ["/Users/me/Downloads/**"],
}

async function mount(initial = request, once = vi.fn().mockResolvedValue(undefined)) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => act(() => root.unmount()))
  const always = vi.fn().mockResolvedValue(undefined)
  const reject = vi.fn().mockResolvedValue(undefined)
  const native = vi.fn().mockResolvedValue(undefined)
  async function render(value = initial, busy = false) {
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: () => {}, t: (key, vars) => translate("zh-CN", key, vars) }}
        >
          <PermissionRequiredCard
            request={value}
            busy={busy}
            onAllowOnce={once}
            onAllowForSession={always}
            onReject={reject}
            onSelectNativeOption={native}
          />
        </I18nContext.Provider>,
      )
    })
  }
  await render()
  const button = (text: string) => {
    const match = [...host.querySelectorAll("button")].find((node) => node.textContent === text)
    if (!match) throw new Error(`Missing button: ${text}`)
    return match
  }
  return { host, render, once, always, reject, native, button }
}

describe("permission card decisions", () => {
  it("defaults to a single approval and prevents duplicate submissions", async () => {
    const once = vi.fn().mockImplementation(() => new Promise(() => {}))
    const card = await mount(request, once)
    expect(card.host.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false")
    await act(async () => {
      card.button("允许这次访问").click()
      card.button("允许这次访问").click()
    })
    expect(once).toHaveBeenCalledExactlyOnceWith("one")
    expect(card.always).not.toHaveBeenCalled()
    expect(card.button("取消此步骤").disabled).toBe(true)
  })
  it("requires an explicit checkbox for repeated access and exposes the saved scope", async () => {
    const card = await mount()
    await act(async () => {
      ;(card.host.querySelector('[role="checkbox"]') as HTMLElement).click()
    })
    expect(card.host.textContent).toContain("/Users/me/Downloads/**")
    await act(async () => card.button("允许这次访问").click())
    expect(card.always).toHaveBeenCalledExactlyOnceWith("one")
    expect(card.once).not.toHaveBeenCalled()
  })
  it("resets the remembered permission when the request changes", async () => {
    const card = await mount()
    await act(async () => {
      ;(card.host.querySelector('[role="checkbox"]') as HTMLElement).click()
    })
    await card.render({ ...request, id: "two" })
    expect(card.host.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false")
    await act(async () => card.button("允许这次访问").click())
    expect(card.once).toHaveBeenCalledExactlyOnceWith("two")
  })
  it("rejects the step without granting permission even when remember is checked", async () => {
    const card = await mount()
    await act(async () => {
      ;(card.host.querySelector('[role="checkbox"]') as HTMLElement).click()
      card.button("取消此步骤").click()
    })
    expect(card.reject).toHaveBeenCalledExactlyOnceWith("one")
    expect(card.once).not.toHaveBeenCalled()
    expect(card.always).not.toHaveBeenCalled()
  })
  it("allows retry after a reply fails without enabling repeated approval", async () => {
    const once = vi.fn().mockRejectedValueOnce(new Error("transport failed")).mockResolvedValue(undefined)
    const card = await mount(
      { ...request, wanta: { automaticReplyFailed: true, promptReason: "automatic_reply_failed" } },
      once,
    )
    expect(card.host.querySelector('[role="checkbox"]')).toBeNull()
    await act(async () => card.button("重试这一步").click())
    expect(card.button("重试这一步").disabled).toBe(false)
    await act(async () => card.button("重试这一步").click())
    expect(once).toHaveBeenCalledTimes(2)
  })
  it("keeps exact locations accessible behind a labelled disclosure", async () => {
    const card = await mount()
    expect(card.host.textContent).toContain("reports")
    expect(card.host.textContent).not.toContain("/Users/me/Downloads/reports")
    expect(card.button("查看操作详情").getAttribute("aria-expanded")).toBe("false")
    await act(async () => card.button("查看操作详情").click())
    expect(card.host.textContent).toContain("/Users/me/Downloads/reports")
  })
})

it("renders native labels and forwards exact options without host grant controls", async () => {
  const nativeOptions = [
    { optionId: "agent-scope", name: "Allow entire tool", kind: "allow_always" as const },
    { optionId: "agent-project", name: "Allow this project", kind: "allow_always" as const },
    { optionId: "deny", name: "Never allow", kind: "reject_always" as const },
  ]
  const card = await mount({ ...request, action: "Read protected file", nativeOptions })
  expect(card.host.querySelector('[role="checkbox"]')).toBeNull()
  expect(card.host.textContent).toContain("Read protected file")
  await act(async () => card.button("Allow this project").click())
  expect(card.native).toHaveBeenCalledExactlyOnceWith("one", nativeOptions[1])
  expect(card.once).not.toHaveBeenCalled()
  expect(card.always).not.toHaveBeenCalled()
  await card.render({ ...request, id: "two", nativeOptions })
  await act(async () => card.button("Never allow").click())
  expect(card.native).toHaveBeenLastCalledWith("two", nativeOptions[2])
})
