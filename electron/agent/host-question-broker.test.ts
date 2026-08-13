import { expect, test } from "vitest"
import { HostQuestionBroker } from "./host-question-broker.ts"

test("HostQuestionBroker blocks until the matching Wanta session answers", async () => {
  const broker = new HostQuestionBroker()
  let requestId = ""
  broker.setAskedHandler((request) => {
    requestId = request.id
  })
  const result = broker.ask("session-1", [
    { header: "Scope", question: "Which scope?", options: [{ label: "A" }, { label: "B" }] },
  ])

  expect(broker.answer("forged-session", requestId, [["A"]])).toBe(false)
  expect(broker.answer("session-1", requestId, [["A"]])).toBe(true)
  await expect(result).resolves.toEqual([["A"]])
  expect(broker.requests()).toEqual([])
})

test("HostQuestionBroker rejects pending calls when their session is removed", async () => {
  const broker = new HostQuestionBroker()
  broker.setAskedHandler(() => undefined)
  const result = broker.ask("session-1", [
    { header: "Scope", question: "Which scope?", options: [{ label: "A" }, { label: "B" }] },
  ])
  broker.cancelSession("session-1")
  await expect(result).rejects.toThrow(/session ended/)
})
