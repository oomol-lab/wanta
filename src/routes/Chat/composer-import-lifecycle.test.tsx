// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ComposerDrafts } from "./composer-draft-store.ts"
import { useComposerAttachments } from "./useComposerAttachments.ts"
import { I18nContext, translate } from "@/i18n/i18n"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const attachment = {
  id: "file",
  path: "/snapshot/file.txt",
  name: "file.txt",
  mime: "text/plain",
  size: 4,
  kind: "file" as const,
}
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
test("an asynchronous file import survives unmount and reaches the original input after remount", async () => {
  let resolve!: (value: typeof attachment) => void
  vi.stubGlobal("wanta", {
    selectedAttachmentPathForFile: () =>
      new Promise((done) => {
        resolve = done
      }),
  })
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  let start!: () => Promise<void>
  function Input({ draftKey }: { draftKey: string }) {
    const binding = drafts.binding(draftKey)
    const state = React.useSyncExternalStore(binding.subscribe, binding.getSnapshot)
    const attachments = useComposerAttachments({
      attachments: state.attachments,
      beginImport: binding.beginImport,
      dispatch: binding.dispatch,
      disabled: false,
      clearInputError: () => {},
      showTrustedInputError: () => {},
      showUnexpectedInputError: () => {},
    })
    start = () => attachments.addFiles([new File(["test"], "file.txt", { type: "text/plain" })])
    return <div>{state.attachments.map((a) => a.name).join(",")}</div>
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const render = async (key: string) => {
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: () => {}, t: (key, vars) => translate("zh-CN", key, vars) }}
        >
          <Input key={key} draftKey={key} />
        </I18nContext.Provider>,
      )
    })
  }
  await render("new")
  let pending!: Promise<void>
  act(() => {
    pending = start()
  })
  await render("other")
  await act(async () => {
    resolve(attachment)
    await pending
  })
  expect(host.textContent).toBe("")
  await render("new")
  expect(host.textContent).toBe("file.txt")
  act(() => root.unmount())
})
