import type { ArtifactBundle } from "./common.ts"
import type { StoredTurnOutputRecord } from "./turn-outputs.ts"

import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { removeSessionOutputDirectories } from "./output-directory-cleanup.ts"

const turnName = "1720000000000-123e4567-e89b-42d3-a456-426614174000"

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false)
}

test("removeSessionOutputDirectories removes managed and project turn directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-output-cleanup-"))
  try {
    const agentRoot = path.join(root, "agent")
    const processRoot = path.join(agentRoot, "process", "session-1", turnName)
    const localArtifactRoot = path.join(agentRoot, "artifacts", "session-1", turnName)
    const projectArtifactRoot = path.join(root, "project", ".wanta", "artifacts", "session-1", turnName)
    const publishedOutput = path.join(root, "project", "report.pdf")
    for (const directory of [processRoot, localArtifactRoot, projectArtifactRoot]) {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, "output.txt"), "output")
    }
    await writeFile(publishedOutput, "published")
    const record = {
      sessionId: "session-1",
      messageId: "assistant-1",
      processRoot,
      createdAt: 1,
      completedAt: 2,
      files: [],
      summary: { processFileCount: 0, changedFileCount: 0, additions: 0, deletions: 0 },
    } satisfies StoredTurnOutputRecord
    const bundle = (rootPath: string, publishedPath?: string): ArtifactBundle => ({
      id: rootPath,
      sessionId: "session-1",
      messageId: rootPath,
      rootPath,
      status: "ready",
      kind: "document",
      display: "single",
      items: publishedPath
        ? [
            {
              id: "published-output",
              kind: "file",
              mime: "application/pdf",
              name: "report.pdf",
              origin: "managed_output",
              path: publishedPath,
              status: "ready",
            },
          ]
        : [],
      totalItems: publishedPath ? 1 : 0,
      truncated: false,
      createdAt: 1,
    })

    await removeSessionOutputDirectories({
      agentRoot,
      artifactBundles: [bundle(localArtifactRoot), bundle(projectArtifactRoot, publishedOutput)],
      sessionId: "session-1",
      turnOutputs: [record],
    })

    assert.equal(await pathExists(processRoot), false)
    assert.equal(await pathExists(localArtifactRoot), false)
    assert.equal(await pathExists(projectArtifactRoot), false)
    assert.equal(await pathExists(publishedOutput), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("removeSessionOutputDirectories ignores persisted paths outside managed layouts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-output-cleanup-boundary-"))
  try {
    const outside = path.join(root, "outside")
    await mkdir(outside)
    await writeFile(path.join(outside, "keep.txt"), "keep")
    const record = {
      sessionId: "session-1",
      messageId: "assistant-1",
      processRoot: outside,
      createdAt: 1,
      completedAt: 2,
      files: [],
      summary: { processFileCount: 0, changedFileCount: 0, additions: 0, deletions: 0 },
    } satisfies StoredTurnOutputRecord

    await removeSessionOutputDirectories({
      agentRoot: path.join(root, "agent"),
      sessionId: "session-1",
      turnOutputs: [record],
    })

    assert.equal(await pathExists(path.join(outside, "keep.txt")), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
