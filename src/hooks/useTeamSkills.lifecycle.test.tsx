import type { UseTeamSkills } from "./useTeamSkills.ts"
import type { Root } from "react-dom/client"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { useTeamSkills } from "./useTeamSkills.ts"

let root: Root | undefined
let view: UseTeamSkills
let sequence = 0
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.unstubAllGlobals()
})

async function mount(strict = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  root = createRoot(document.createElement("div"))
  const initialTeam = `lifecycle-${++sequence}`
  function Probe({ team, account }: { team: string; account: string }) {
    view = useTeamSkills({ canManage: true, team: null, teamId: team, role: null }, account)
    return null
  }
  const render = async (team = initialTeam, account = "account-a") => {
    await act(async () =>
      root!.render(
        strict ? (
          <React.StrictMode>
            <Probe team={team} account={account} />
          </React.StrictMode>
        ) : (
          <Probe team={team} account={account} />
        ),
      ),
    )
  }
  await render()
  return render
}

function pendingFetch() {
  const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = []
  const fetcher = vi.fn(
    (_url: unknown, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({ signal: init.signal as AbortSignal, resolve })
      }),
  )
  vi.stubGlobal("fetch", fetcher)
  return { requests, fetcher }
}

test("StrictMode cancels before network dispatch and concurrent refreshes share one GET", async () => {
  const { requests, fetcher } = pendingFetch()
  await mount(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  let refresh!: Promise<void>
  await act(async () => {
    refresh = view.refresh()
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async () => {
    requests[0]!.resolve(Response.json({ data: [] }))
    await refresh
  })
  expect(view.hasLoaded).toBe(true)
  expect(view.error).toBeNull()
})

test("team switch cancels abandoned network work and late responses cannot replace the new team", async () => {
  const { requests } = pendingFetch()
  const render = await mount()
  await render("different-team")
  expect(requests[0]!.signal.aborted).toBe(true)
  await act(async () => {
    requests[1]!.resolve(Response.json({ data: [{ name: "new", skills: [{ name: "new" }] }] }))
  })
  await act(async () => requests[0]!.resolve(Response.json({ data: [{ name: "old", skills: [{ name: "old" }] }] })))
  expect(view.skills.map((s) => s.skillName)).toEqual(["new"])
})

test("malformed refresh preserves the last successful team configuration and exposes an error", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: [{ name: "demo", skills: [{ name: "alpha" }] }] }))
  vi.stubGlobal("fetch", fetcher)
  await mount()
  fetcher.mockImplementation(async () => Response.json({ data: "invalid" }))
  await act(async () => view.refresh({ forceRefresh: true }))
  expect(view.skills.map((s) => s.skillName)).toEqual(["alpha"])
  expect(view.error).not.toBeNull()
})

test("account switch does not share a previous account's pending team request", async () => {
  const { requests } = pendingFetch()
  const render = await mount()
  await render(undefined, "account-b")
  expect(requests).toHaveLength(2)
  expect(requests[0]!.signal.aborted).toBe(true)
  expect(view.skills).toEqual([])
  await act(async () => requests[1]!.resolve(Response.json({ data: [] })))
})

test("a malformed cold load exposes an error instead of an empty success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "invalid" })),
  )
  await mount()
  expect(view.error).not.toBeNull()
  expect(view.hasLoaded).toBe(false)
})

test("force refresh prevents a superseded response from replacing fresh data or cache", async () => {
  const { requests, fetcher } = pendingFetch()
  await mount()
  let refresh!: Promise<void>
  await act(async () => {
    refresh = view.refresh({ forceRefresh: true })
  })
  expect(requests[0]!.signal.aborted).toBe(true)
  await act(async () => {
    requests[1]!.resolve(Response.json({ data: [{ name: "fresh", skills: [{ name: "fresh" }] }] }))
    await refresh
  })
  await act(async () => requests[0]!.resolve(Response.json({ data: [{ name: "old", skills: [{ name: "old" }] }] })))
  await act(async () => view.refresh())
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(view.skills.map((s) => s.skillName)).toEqual(["fresh"])
  expect(view.error).toBeNull()
})
