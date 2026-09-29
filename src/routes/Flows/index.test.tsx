import type { Team } from "../../../electron/teams/common.ts"
import type { OpenFlowWorkbenchProps } from "@oomol-lab/open-flow/workbench"
// @vitest-environment happy-dom
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { createFlowHost } from "./host.ts"
import { FlowsRoute } from "./index.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const { workbench, invoke, dispose } = vi.hoisted(() => ({ workbench: vi.fn(), invoke: vi.fn(), dispose: vi.fn() }))
vi.mock("@oomol-lab/open-flow/workbench", () => ({
  isWorkbenchLanguage: (locale: string) => locale !== "es",
  OpenFlowWorkbench: (props: OpenFlowWorkbenchProps) => {
    workbench(props)
    return (
      <button
        onClick={() => props.onNavigate({ flowId: "flow-a", view: "runs", runSource: "draft" }, { replace: false })}
      >
        Open runs
      </button>
    )
  },
}))
vi.mock("./host.ts", () => ({ createFlowHost: vi.fn(() => ({ dispose })) }))
vi.mock("@/components/AppContext", () => ({ useChatService: () => service }))
vi.mock("@/components/theme-context", () => ({ useTheme: () => ({ effectiveTheme: "dark" }) }))
const service = { invoke }
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const team: Team = { id: "team-a", name: "team-name", avatar: "", creator_user_id: "user" }
const configure = vi.fn()
function render(selected: Team | null = team, accountId = "account", writable = true, locale: "en" | "es" = "en") {
  root ??= createRoot(document.body.appendChild(document.createElement("div")))
  root.render(
    <I18nContext.Provider value={{ locale, setLocale: vi.fn(), t: (key, vars) => translate(locale, key, vars) }}>
      <FlowsRoute accountId={accountId} team={selected} writable={writable} onConfigureConnector={configure} />
    </I18nContext.Provider>,
  )
}
function props(): OpenFlowWorkbenchProps {
  return workbench.mock.calls.at(-1)![0]
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

it("binds the team name, theme and navigation without browser route changes", async () => {
  await act(async () => render())
  expect(vi.mocked(createFlowHost).mock.calls[0][0]).toMatchObject({ teamName: "team-name", writable: true })
  expect(props()).toMatchObject({ language: "en", theme: "dark", variables: true, location: { view: "design" } })
  await act(async () => document.querySelector("button")!.click())
  expect(props().location).toEqual({ flowId: "flow-a", view: "runs", runSource: "draft" })
  props().onConfigureConnector!()
  expect(configure).toHaveBeenCalledOnce()
})

it("disposes the old scope and returns to the catalog on account or team changes", async () => {
  await act(async () => render())
  await act(async () => document.querySelector("button")!.click())
  await act(async () => render({ ...team, id: "team-b", name: "other-name" }))
  expect(dispose).toHaveBeenCalledOnce()
  expect(props().location).toEqual({ view: "design" })
  await act(async () => render(team, "other-account"))
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(props().sessionKey).toContain("other-account")
})

it("updates locale with an English fallback without destroying the editor", async () => {
  await act(async () => render())
  const sessionKey = props().sessionKey
  await act(async () => document.querySelector("button")!.click())
  await act(async () => render(team, "account", true, "es"))
  expect(props().language).toBe("en")
  expect(props().sessionKey).toBe(sessionKey)
  expect(props().location.flowId).toBe("flow-a")
  expect(dispose).not.toHaveBeenCalled()
  expect(createFlowHost).toHaveBeenCalledOnce()
})

it("does not connect without a team or for paused teams, and disables read-only creation", async () => {
  await act(async () => render(null))
  expect(document.body.textContent).toContain("Select a team")
  expect(createFlowHost).not.toHaveBeenCalled()
  await act(async () => render({ ...team, status: "paused" }))
  expect(document.body.textContent).toContain("paused")
  expect(createFlowHost).not.toHaveBeenCalled()
  await act(async () => render(team, "account", false))
  expect(props().createFlowDisabled).toBe(true)
  expect(vi.mocked(createFlowHost).mock.calls[0][0].writable).toBe(false)
})
