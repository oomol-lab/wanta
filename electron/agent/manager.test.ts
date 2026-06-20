import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AgentManager, buildPromptParts, isUserVisibleSession, trustedAgentAttachmentRoot } from "./manager.ts"

describe("AgentManager", () => {
  it("hides OpenCode subagent sessions from the user task list", () => {
    expect(isUserVisibleSession({ id: "root", title: "Root" })).toBe(true)
    expect(isUserVisibleSession({ id: "child", parentID: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parentId: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parent_id: "root", title: "Child" })).toBe(false)
  })

  it("frames connected providers as authorization awareness only", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "lumo-agent-"))
    try {
      const manager = new AgentManager({
        apiKey: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      manager.listAuthorizedServices = async () => ["gmail", "slack"]

      const system = await manager.buildAuthorizedSystem()

      expect(system).toContain("Some Link providers are already authorized")
      expect(system).toContain("availability awareness only")
      expect(system).toContain("not a recommendation to use Link tools")
      expect(system).toContain("search results include whether a provider is authenticated")
      expect(system).toContain("concrete URLs")
      expect(system).not.toContain("gmail")
      expect(system).not.toContain("slack")
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("keeps artifact directories inside the artifacts root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "lumo-agent-"))
    try {
      const manager = new AgentManager({
        apiKey: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })

      const dir = await manager.createArtifactDir("..")
      const artifactsRoot = path.resolve(rootDir, "artifacts")
      const relative = path.relative(artifactsRoot, dir)

      expect(relative).not.toBe("..")
      expect(relative.startsWith(`..${path.sep}`)).toBe(false)
      expect(path.isAbsolute(relative)).toBe(false)
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("uses agent attachment copies only from the controlled clipboard attachment directory", () => {
    const agentRoot = path.join(tmpdir(), "lumo-user-data", "agent")
    const trustedRoot = trustedAgentAttachmentRoot(agentRoot)
    const originalPath = path.join(tmpdir(), "original.png")
    const trustedAgentPath = path.join(trustedRoot, "optimized.webp")
    const untrustedAgentPath = path.join(tmpdir(), "other", "secret.txt")

    const trustedParts = buildPromptParts(
      "Read image",
      [
        {
          id: "att-1",
          name: "original.png",
          mime: "image/png",
          size: 100,
          path: originalPath,
          kind: "file",
          agentName: "optimized.webp",
          agentMime: "image/webp",
          agentPath: trustedAgentPath,
          agentSize: 80,
        },
      ],
      trustedRoot,
    )
    const untrustedParts = buildPromptParts(
      "Read image",
      [
        {
          id: "att-2",
          name: "original.png",
          mime: "image/png",
          size: 100,
          path: originalPath,
          kind: "file",
          agentName: "secret.txt",
          agentMime: "text/plain",
          agentPath: untrustedAgentPath,
          agentSize: 80,
        },
      ],
      trustedRoot,
    )

    expect(trustedParts[0]).toMatchObject({
      filename: "optimized.webp",
      mime: "image/webp",
      source: { path: trustedAgentPath },
    })
    expect(untrustedParts[0]).toMatchObject({
      filename: "original.png",
      mime: "image/png",
      source: { path: originalPath },
    })
  })
})
