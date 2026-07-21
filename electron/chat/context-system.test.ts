import assert from "node:assert/strict"
import { test } from "vitest"
import { buildContextMentionsSystem, buildPermissionModeSystem, buildResponseLanguageSystem } from "./context-system.ts"

test("buildContextMentionsSystem describes a pinned knowledge base without exposing a path", () => {
  const prompt = buildContextMentionsSystem([{ id: "kb-1", kind: "knowledge", name: "西游记" }]) ?? ""

  assert.match(prompt, /query_knowledge/)
  assert.match(prompt, /kb-1/)
  assert.match(prompt, /西游记/)
  assert.match(prompt, /Never modify/)
  assert.match(prompt, /Mermaid graph focused/)
  assert.match(prompt, /5-8 core entities/)
  assert.match(prompt, /Do not emit style directives/)
  assert.match(prompt, /Never invoke the WikiGraph CLI directly/)
  assert.doesNotMatch(prompt, /\/Users\//)
})

test("buildPermissionModeSystem describes default access", () => {
  const prompt = buildPermissionModeSystem("default")

  assert.match(prompt, /Default Access/)
  assert.match(prompt, /Use bash normally/)
  assert.match(prompt, /Ordinary shell commands/)
  assert.match(prompt, /credential\/secret paths/)
  assert.match(prompt, /dependency installation/)
  assert.doesNotMatch(prompt, /user has enabled Full Access/)
})

test("buildPermissionModeSystem describes full access", () => {
  const prompt = buildPermissionModeSystem("full_access")

  assert.match(prompt, /Full Access \(session-scoped local YOLO\)/)
  assert.match(prompt, /YOLO for local tools/)
  assert.match(prompt, /edit files/)
  assert.match(prompt, /access external filesystem paths/)
  assert.match(prompt, /Local permission requests are auto-approved/)
  assert.match(prompt, /Do not ask the user to switch modes or approve local tool calls/)
  assert.match(prompt, /non-local business workflow explicitly requires user approval/)
})

test("buildResponseLanguageSystem follows the latest request and uses English only as a fallback", () => {
  const prompt = buildResponseLanguageSystem("en")

  assert.match(prompt, /primary language of the user's latest substantive request/)
  assert.match(prompt, /progress updates, tool-call commentary, structured questions/)
  assert.match(prompt, /explicitly requests a response or deliverable language/)
  assert.match(prompt, /not from quoted material, source documents, attachments, tool output, skill content/)
  assert.match(prompt, /continue the established conversation language/)
  assert.match(prompt, /application interface language: English/)
})

test("buildResponseLanguageSystem uses Chinese only as a fallback", () => {
  const prompt = buildResponseLanguageSystem("zh-CN")

  assert.match(prompt, /primary language of the user's latest substantive request/)
  assert.match(prompt, /application interface language: Simplified Chinese/)
  assert.doesNotMatch(prompt, /application interface language: English/)
})

test("buildResponseLanguageSystem does not interpolate an unavailable locale", () => {
  const prompt = buildResponseLanguageSystem(undefined)

  assert.match(prompt, /language that best fits the user's available context/)
  assert.doesNotMatch(prompt, /application interface language:/)
})
