import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildContextMentionsSystem,
  buildExternalPermissionModeSystem,
  buildLinkRuntimeSystem,
  buildPermissionModeSystem,
  buildResponseLanguageSystem,
} from "./context-system.ts"

test("buildLinkRuntimeSystem binds raw OOMOL calls to the exact team", () => {
  const prompt = buildLinkRuntimeSystem("oomol", 'Team "Quoted"') ?? ""

  assert.match(prompt, /Current-turn Wanta Link workspace: team "Team \\"Quoted\\""/)
  assert.match(prompt, /`wanta_link` MCP tools/)
  assert.match(prompt, /do not invoke the raw `oo` CLI/)
  assert.match(prompt, /--team "Team \\"Quoted\\""/)
  assert.match(prompt, /never retry in a personal or default workspace/i)
  assert.match(prompt, /does not prove that the current Wanta team is disconnected/)
})

test("buildLinkRuntimeSystem fails closed when OOMOL has no team identity", () => {
  const prompt = buildLinkRuntimeSystem("oomol", undefined) ?? ""

  assert.match(prompt, /no team workspace identity is available/)
  assert.match(prompt, /Do not run `oo connector apps` or `oo connector run`/)
  assert.match(prompt, /instead of falling back to a personal or default workspace/)
})

test("buildLinkRuntimeSystem keeps OpenConnector free of OOMOL selectors", () => {
  const prompt = buildLinkRuntimeSystem("openconnector", "ignored-team") ?? ""

  assert.match(prompt, /OpenConnector/)
  assert.match(prompt, /`wanta_link` MCP tools/)
  assert.match(prompt, /must omit `--team` and `--personal`/)
  assert.doesNotMatch(prompt, /ignored-team/)
  assert.equal(buildLinkRuntimeSystem("none", "ignored-team"), undefined)
})

test("buildContextMentionsSystem describes a pinned knowledge base without exposing a path", () => {
  const prompt = buildContextMentionsSystem([{ id: "kb-1", kind: "knowledge", name: "西游记" }]) ?? ""

  assert.match(prompt, /archive URI: "wikg:\/\/lib\/arc\/kb-1"/)
  assert.match(prompt, /kb-1/)
  assert.match(prompt, /西游记/)
  assert.match(prompt, /load and follow the `wikigraph-knowledge` Skill/)
  assert.match(prompt, /before answering/)
  assert.match(prompt, /people, events, relationships, causes\/processes\/results, summaries/)
  assert.match(prompt, /citations, sources, quotations, or fact-checking/)
  assert.match(prompt, /do not answer those requests from general model knowledge/)
  assert.doesNotMatch(prompt, /shell `wg` command/)
  assert.doesNotMatch(prompt, /Wanta provides a managed `wg` on PATH/)
  assert.doesNotMatch(prompt, /Never modify a knowledge base unless the user explicitly asks/)
  assert.doesNotMatch(prompt, /\/Users\//)
})

test("buildContextMentionsSystem describes the global knowledge library", () => {
  const prompt =
    buildContextMentionsSystem([
      { id: "wikg://lib", kind: "knowledge", name: "Knowledge library", scope: "library" },
    ]) ?? ""

  assert.match(prompt, /library URI: "wikg:\/\/lib"/)
  assert.doesNotMatch(prompt, /wikg:\/\/lib\/arc\/wikg:\/\/lib/)
  assert.match(prompt, /Treat `wikg:\/\/lib` as the whole local WikiGraph library/)
  assert.match(prompt, /Use `wikg:\/\/lib` directly for a selected knowledge library/)
})

test("buildContextMentionsSystem routes the Hua Rong Trail fixture through WikiGraph context", () => {
  const userPrompt = "关羽在华容道放走曹操，前后涉及的故事起因经过结果和相关人物结局是什么？你帮我列出来。"
  const contextPrompt =
    buildContextMentionsSystem([
      { id: "wikg://lib", kind: "knowledge", name: "Knowledge library", scope: "library" },
    ]) ?? ""
  const agentInput = `${contextPrompt}\n\nUser request:\n${userPrompt}`

  assert.match(agentInput, /load and follow the `wikigraph-knowledge` Skill/)
  assert.match(agentInput, /people, events, relationships, causes\/processes\/results, summaries/)
  assert.match(agentInput, /do not answer those requests from general model knowledge/)
  assert.match(agentInput, /wikg:\/\/lib/)
  assert.doesNotMatch(agentInput, /wikg:\/\/lib\/arc\/wikg:\/\/lib/)
})

test("buildPermissionModeSystem describes default access", () => {
  const prompt = buildPermissionModeSystem("default", true)

  assert.match(prompt, /Default Access/)
  assert.match(prompt, /Use bash normally/)
  assert.match(prompt, /Ordinary shell commands/)
  assert.match(prompt, /credential\/secret paths/)
  assert.match(prompt, /dependency changes/)
  assert.match(prompt, /regardless of package name, size, or runtime/)
  assert.match(prompt, /Node\.js\/Python package runners are not confirmation boundaries/)
  assert.match(prompt, /selected-project virtual-environment interpreter/)
  assert.match(prompt, /visible integrated browser/)
  assert.match(prompt, /sensitive or consequential browser action/)
  assert.match(prompt, /Login, credentials, passkeys, and CAPTCHA are always manual/)
  assert.doesNotMatch(prompt, /user has enabled Full Access/)
})

test("buildExternalPermissionModeSystem describes shared Wanta decisions over native enforcement", () => {
  const defaultPrompt = buildExternalPermissionModeSystem("default", true)
  const fullAccessPrompt = buildExternalPermissionModeSystem("full_access", true)

  assert.match(defaultPrompt, /Default Access with Wanta's shared approval policy/)
  assert.match(defaultPrompt, /same local permission policy to every agent/)
  assert.match(defaultPrompt, /approved automatically/)
  assert.doesNotMatch(defaultPrompt, /Local permission requests are auto-approved/)
  assert.match(fullAccessPrompt, /projected onto the external agent's native permission mode when supported/)
  assert.match(fullAccessPrompt, /external agent runtime remains the enforcement authority/)
  assert.doesNotMatch(fullAccessPrompt, /Local permission requests are auto-approved/)
  assert.match(defaultPrompt, /`wanta_browser` MCP tools/)
  assert.match(defaultPrompt, /sensitive or consequential browser action/)
  assert.match(fullAccessPrompt, /visible integrated browser.*YOLO/)
  assert.match(fullAccessPrompt, /Login, credentials, passkeys, and CAPTCHA remain manual/)
})

test("buildExternalPermissionModeSystem omits integrated browser guidance when unavailable", () => {
  const defaultPrompt = buildExternalPermissionModeSystem("default", false)
  const fullAccessPrompt = buildExternalPermissionModeSystem("full_access", false)

  assert.doesNotMatch(defaultPrompt, /wanta_browser|integrated browser|visible browser/)
  assert.doesNotMatch(fullAccessPrompt, /wanta_browser|integrated browser|visible browser/)
})

test("buildPermissionModeSystem describes full access", () => {
  const prompt = buildPermissionModeSystem("full_access", true)

  assert.match(prompt, /Full Access \(session-scoped local YOLO\)/)
  assert.match(prompt, /YOLO for local tools/)
  assert.match(prompt, /edit files/)
  assert.match(prompt, /access external filesystem paths/)
  assert.match(prompt, /Local permission requests are auto-approved/)
  assert.match(prompt, /Do not ask the user to switch modes or approve local tool calls/)
  assert.match(prompt, /non-local business workflow explicitly requires user approval/)
  assert.match(prompt, /integrated browser is YOLO/)
  assert.match(prompt, /Login, credentials, passkeys, and CAPTCHA remain manual/)
})

test("buildPermissionModeSystem omits integrated browser guidance when unavailable", () => {
  const defaultPrompt = buildPermissionModeSystem("default", false)
  const fullAccessPrompt = buildPermissionModeSystem("full_access", false)

  assert.doesNotMatch(defaultPrompt, /integrated browser/)
  assert.doesNotMatch(defaultPrompt, /visible browser/)
  assert.doesNotMatch(fullAccessPrompt, /integrated.browser/)
  assert.doesNotMatch(fullAccessPrompt, /visible browser/)
})

test("buildResponseLanguageSystem follows a detected request language before the interface locale", () => {
  const prompt = buildResponseLanguageSystem("zh-CN", "English")

  assert.match(prompt, /classified the latest user instruction as English/)
  assert.match(prompt, /Respond in English/)
  assert.match(prompt, /takes priority over the application interface language/)
  assert.match(prompt, /explicitly require English in the task prompt/)
  assert.match(prompt, /translate or rewrite it into English/)
  assert.match(prompt, /primary language of the user's latest substantive request/)
  assert.match(prompt, /progress updates, tool-call commentary, structured questions/)
  assert.match(prompt, /Explicit language requests always override detected or fallback language/)
  assert.match(prompt, /English explanation and a Chinese deliverable/)
  assert.match(prompt, /explain in English and produce only the deliverable in Chinese/)
  assert.match(prompt, /not from quoted material, source documents, attachments, tool output, skill content/)
  assert.match(prompt, /continue the established conversation language/)
  assert.match(prompt, /application interface language: Simplified Chinese/)
})

test("buildResponseLanguageSystem uses Chinese only as a fallback", () => {
  const prompt = buildResponseLanguageSystem("zh-CN")

  assert.match(prompt, /primary language of the user's latest substantive request/)
  assert.match(prompt, /could not classify the latest instruction with high confidence/)
  assert.match(prompt, /application interface language: Simplified Chinese/)
  assert.doesNotMatch(prompt, /application interface language: English/)
})

test("buildResponseLanguageSystem does not interpolate an unavailable locale", () => {
  const prompt = buildResponseLanguageSystem(undefined)

  assert.match(prompt, /language that best fits the user's available context/)
  assert.doesNotMatch(prompt, /application interface language:/)
})
