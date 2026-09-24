import type { UseChat } from "@/hooks/useChat"
// @vitest-environment happy-dom
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { sessionScopeKey } from "./app-shell-model.ts"
import { useComposerSubmission } from "./use-composer-submission.ts"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

it("starts a distinct team knowledge task without leaving the knowledge route", async () => {
  const scope = { kind: "team" as const, teamId: "team-1", teamName: "Team" }
  const createSession = vi.fn(async () => ({ id: "new-task", title: "Question", createdAt: 1, updatedAt: 1, scope }))
  const send = vi.fn(async () => undefined)
  const setRoute = vi.fn()
  const setSelectedSessionId = vi.fn()
  let submission!: ReturnType<typeof useComposerSubmission>
  function Harness() {
    submission = useComposerSubmission({
      activeChatSessionId: "old-task",
      activeComposerDraftKey: "old-draft",
      activeSession: { id: "old-task", title: "Old", createdAt: 0, updatedAt: 0, scope },
      createSession,
      currentScopeKey: sessionScopeKey(scope),
      displayedPermissionMode: "default",
      draftAgentKind: "opencode",
      messages: [],
      messagesLoaded: true,
      teamSkills: [],
      persistPermissionMode: async () => {},
      send: send as unknown as UseChat["send"],
      sessionScope: scope,
      setIsDraftSession: vi.fn(),
      setPendingChatTransition: vi.fn(),
      setRoute,
      setSelectedSessionId,
      setSidebarSegment: vi.fn(),
      titleGeneration: {
        getAutoFallbackTitle: () => undefined,
        isAutoRefreshable: () => false,
        refreshGeneratedTitle: async () => {},
        rememberAutoFallbackTitle: () => {},
      },
    })
    return null
  }
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root?.render(<Harness />))
  let result: Awaited<ReturnType<typeof submission.sendNow>> | undefined
  await act(async () => {
    result = await submission.sendNow({
      text: "What do these sources recommend?",
      contextMentions: [{ kind: "cloud-knowledge", id: "team-1", displayName: "Knowledge" }],
      permissionMode: "default",
      startNewSession: true,
      knowledgeMode: true,
      stayOnKnowledge: true,
    })
  })
  expect(result).toEqual({ status: "accepted", delivery: "sent" })
  expect(createSession).toHaveBeenCalledOnce()
  expect(createSession).toHaveBeenCalledWith(expect.any(String), undefined, { knowledgeMode: true })
  expect(send).toHaveBeenCalledWith(
    "new-task",
    "What do these sources recommend?",
    [],
    expect.objectContaining({
      contextMentions: [{ kind: "cloud-knowledge", id: "team-1", displayName: "Knowledge" }],
      sessionScope: scope,
    }),
  )
  expect(setSelectedSessionId).toHaveBeenCalledWith("new-task")
  expect(setRoute).not.toHaveBeenCalled()
})
