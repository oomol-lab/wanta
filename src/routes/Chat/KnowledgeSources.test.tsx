// @vitest-environment happy-dom
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { KnowledgeSources } from "./KnowledgeSources.tsx"
import { I18nContext, translate } from "@/i18n/i18n"
import { KnowledgeNavigationContext } from "@/routes/Knowledge/navigation"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

it("opens only a source from a completed real retrieval result", async () => {
  const openSource = vi.fn()
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () =>
    root?.render(
      <I18nContext.Provider value={{ locale: "en", setLocale: () => {}, t: (key, vars) => translate("en", key, vars) }}>
        <KnowledgeNavigationContext.Provider value={openSource}>
          <KnowledgeSources
            part={{
              kind: "tool",
              partId: "part-1",
              tool: "call_action",
              status: "completed",
              input: { service: "oomol_rag", action: "retrieve" },
              output: JSON.stringify({
                requestId: "r",
                items: [{ fileId: "f-1", filename: "guide.pdf", text: "The policy", score: 0.9 }],
              }),
            }}
          />
        </KnowledgeNavigationContext.Provider>
      </I18nContext.Provider>,
    ),
  )
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click())
  expect(openSource).toHaveBeenCalledWith({ file_id: "f-1", filename: "guide.pdf", text: "The policy", score: 0.9 })
})
