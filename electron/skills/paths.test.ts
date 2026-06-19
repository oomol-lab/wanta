import type { SupportedAgent } from "../agents/catalog.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import { resolveAgentHomeRoot, resolveAgentRelativeSkillRoot } from "../agents/catalog.ts"
import { resolveOoStoreDirectory } from "../oo-store-paths.ts"
import { resolveCanonicalSourcePath, resolveSharedAgentSkillRoot } from "./paths.ts"

const agent: SupportedAgent = {
  cliCommands: ["agent"],
  homeEnvVar: "AGENT_HOME",
  homeRoot: ".agent",
  id: "agent",
  name: "Agent",
  ooCliAgentId: "agent",
}

test("resolveAgentHomeRoot uses explicit env var first", () => {
  assert.equal(resolveAgentHomeRoot(agent, { AGENT_HOME: "/tmp/custom-agent" }, "/home/me"), "/tmp/custom-agent")
})

test("resolveAgentHomeRoot falls back to home directory", () => {
  assert.equal(resolveAgentHomeRoot(agent, {}, "/home/me"), path.join("/home/me", ".agent"))
})

test("resolveAgentRelativeSkillRoot follows agent home root", () => {
  assert.equal(resolveAgentRelativeSkillRoot(agent), path.join(".agent", "skills"))
})

test("resolveOoStoreDirectory follows platform conventions", () => {
  assert.equal(resolveOoStoreDirectory({}, "darwin", "/Users/me"), "/Users/me/Library/Application Support/oo")
  assert.equal(resolveOoStoreDirectory({}, "linux", "/home/me"), "/home/me/.config/oo")
  assert.equal(
    resolveOoStoreDirectory({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32", "C:\\Users\\me"),
    path.win32.join("C:\\Users\\me\\AppData\\Roaming", "oo"),
  )
})

test("resolveOoStoreDirectory honors XDG_CONFIG_HOME", () => {
  assert.equal(resolveOoStoreDirectory({ XDG_CONFIG_HOME: "/tmp/config" }, "linux", "/home/me"), "/tmp/config/oo")
})

test("resolveOoStoreDirectory ignores empty environment path overrides", () => {
  assert.equal(resolveOoStoreDirectory({ XDG_CONFIG_HOME: "" }, "linux", "/home/me"), "/home/me/.config/oo")
  assert.equal(
    resolveOoStoreDirectory({ APPDATA: "" }, "win32", "C:\\Users\\me"),
    path.win32.join("C:\\Users\\me", "AppData", "Roaming", "oo"),
  )
})

test("resolveOoStoreDirectory rejects relative roots", () => {
  assert.throws(() => resolveOoStoreDirectory({}, "linux", "relative-home"), /absolute path/)
  assert.throws(
    () => resolveOoStoreDirectory({ XDG_CONFIG_HOME: "relative-config" }, "linux", "/home/me"),
    /absolute path/,
  )
})

test("resolveSharedAgentSkillRoot follows the common Agent Skills location", () => {
  assert.equal(resolveSharedAgentSkillRoot("/Users/me"), path.join("/Users/me", ".agents", "skills"))
  assert.throws(() => resolveSharedAgentSkillRoot("relative-home"), /absolute path/)
})

test("resolveCanonicalSourcePath returns absolute fallback and rejects path traversal names", () => {
  assert.equal(
    resolveCanonicalSourcePath({
      agent,
      metadata: { kind: "local" },
      name: "demo",
      path: "relative/demo",
    }),
    path.resolve("relative/demo"),
  )

  assert.throws(
    () =>
      resolveCanonicalSourcePath({
        agent,
        metadata: { kind: "registry" },
        name: "../escape",
        path: "/tmp/escape",
      }),
    /Invalid skill name/,
  )
})
