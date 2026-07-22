import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  ArtifactBundleStore,
  buildArtifactBundle,
  captureArtifactSessionBaseline,
  generatedImagePreviewCount,
  markdownImageCount,
  materializeAssistantArtifacts,
  readResponseBodyWithinLimit,
  recordArtifactBundle,
  recoverMisplacedTurnArtifacts,
} from "./artifact-bundles.ts"

test("buildArtifactBundle infers an image gallery without a model-authored manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-bundle-"))
  try {
    await writeFile(path.join(root, "001.png"), "one")
    await writeFile(path.join(root, "002.png"), "two")

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.status, "ready")
    assert.equal(bundle?.kind, "image_set")
    assert.equal(bundle?.display, "gallery")
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["001.png", "002.png"],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle omits resumable task state beside final image outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-session-state-"))
  try {
    await writeFile(path.join(root, "summer.png"), "image")
    await writeFile(
      path.join(root, "summer.session.json"),
      JSON.stringify({
        session_id: "image-session-1",
        mode: "generate",
        result_action: "image_async_result",
        out_dir: root,
        output_format: "png",
        submitted_at: "2026-07-11T00:00:00.000Z",
        payload: { prompt: "summer" },
      }),
    )

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 1,
      materializedOrigins: new Map([["summer.png", "assistant_preview"]]),
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.status, "ready")
    assert.equal(bundle?.kind, "image_set")
    assert.equal(bundle?.display, "gallery")
    assert.equal(bundle?.totalItems, 1)
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["summer.png"],
    )
    assert.match(await readFile(path.join(root, "summer.session.json"), "utf8"), /image-session-1/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle keeps legitimate and uncertain JSON deliverables", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-json-deliverables-"))
  try {
    await writeFile(path.join(root, "report.pdf"), "report")
    await writeFile(path.join(root, "report.json"), JSON.stringify({ session_id: "business-session", result: "ok" }))
    await writeFile(path.join(root, "auth.session.json"), JSON.stringify({ session_id: "business-session", user: "1" }))
    await writeFile(path.join(root, "broken.session.json"), "not-json")

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.totalItems, 4)
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["auth.session.json", "broken.session.json", "report.json", "report.pdf"],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle keeps a lone operational state file as the only output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-only-state-"))
  try {
    await writeFile(
      path.join(root, "task.resume.json"),
      JSON.stringify({ task_id: "task-1", poll_count: 2, result_action: "get_result" }),
    )

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.totalItems, 1)
    assert.equal(bundle?.items[0]?.name, "task.resume.json")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle keeps explicitly materialized state-shaped attachments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-explicit-state-"))
  try {
    await writeFile(path.join(root, "result.png"), "image")
    await writeFile(
      path.join(root, "requested.session.json"),
      JSON.stringify({ session_id: "requested", result_action: "get_result" }),
    )

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      materializedOrigins: new Map([["requested.session.json", "assistant_attachment"]]),
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.totalItems, 2)
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["requested.session.json", "result.png"],
    )
    assert.equal(bundle?.items[0]?.origin, "assistant_attachment")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle records a visible generated image that was not persisted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-bundle-failed-"))
  try {
    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 2,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.status, "failed")
    assert.equal(bundle?.failure, "generated_preview_not_persisted")
    assert.equal(bundle?.items.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("markdownImageCount counts final assistant image previews", () => {
  assert.equal(
    markdownImageCount(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: "![one](https://example.com/one.png)\n![two](<data:image/png;base64,abc>)",
            },
          ],
        },
      ],
      "assistant-1",
    ),
    2,
  )
})

test("markdownImageCount repairs spaced local paths and ignores code examples", () => {
  assert.equal(
    markdownImageCount(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: [
                "![result](/Users/me/Application Support/wanta/result.png)",
                "```md",
                "![example](https://example.com/example.png)",
                "```",
              ].join("\n"),
            },
          ],
        },
      ],
      "assistant-1",
    ),
    1,
  )
})

test("generatedImagePreviewCount includes assistant image attachments without double-counting previews", () => {
  assert.equal(
    generatedImagePreviewCount(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            { kind: "text", partId: "text-1", text: "![one](https://example.com/one.png)" },
            {
              kind: "attachment",
              partId: "image-1",
              attachment: {
                id: "image-1",
                kind: "file",
                mime: "image/png",
                name: "one.png",
                path: "https://example.com/one.png",
                size: 0,
              },
            },
          ],
        },
      ],
      "assistant-1",
    ),
    1,
  )
})

test("buildArtifactBundle marks incomplete preview attribution as unverified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-bundle-partial-"))
  try {
    await writeFile(path.join(root, "001.png"), "one")

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 2,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.status, "partial")
    assert.equal(bundle?.failure, "generated_preview_persistence_unverified")
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["001.png"],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("buildArtifactBundle does not let an unrelated image mask a failed generated preview", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-unrelated-image-"))
  try {
    await writeFile(path.join(root, "existing.png"), "unrelated")

    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 1,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(bundle?.status, "partial")
    assert.equal(bundle?.failure, "generated_preview_persistence_unverified")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts copies assistant files into managed storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-materialize-"))
  try {
    const managed = path.join(root, "managed")
    const generated = path.join(root, "temporary-image.png")
    await mkdir(managed)
    await writeFile(generated, "image")
    const copied = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "attachment",
              partId: "image-1",
              attachment: {
                id: "image-1",
                kind: "file",
                mime: "image/png",
                name: "temporary-image.png",
                path: generated,
                size: 5,
              },
            },
          ],
        },
      ],
      "assistant-1",
      managed,
    )

    assert.deepEqual([...copied], [["temporary-image.png", "assistant_attachment"]])
    assert.equal(await readFile(path.join(managed, "temporary-image.png"), "utf8"), "image")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts records an image source already inside managed storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-already-managed-"))
  try {
    const imagePath = path.join(root, "generated.png")
    await writeFile(imagePath, "image")
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "attachment",
              partId: "image-1",
              attachment: {
                id: "image-1",
                kind: "file",
                mime: "image/png",
                name: "generated.png",
                path: imagePath,
                size: 5,
              },
            },
          ],
        },
      ],
      "assistant-1",
      root,
    )

    assert.deepEqual([...origins], [["generated.png", "assistant_attachment"]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts prefers a duplicate markdown image over a non-image attachment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-duplicate-source-"))
  const sourcePath = path.join(path.dirname(root), `${path.basename(root)}-source.png`)
  try {
    await writeFile(sourcePath, "image")
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "attachment",
              partId: "file-1",
              attachment: {
                id: "file-1",
                kind: "file",
                mime: "application/octet-stream",
                name: "source.png",
                path: sourcePath,
                size: 5,
              },
            },
            { kind: "text", partId: "text-1", text: `![generated](${sourcePath})` },
          ],
        },
      ],
      "assistant-1",
      root,
    )

    assert.deepEqual([...origins.values()], ["assistant_preview"])
  } finally {
    await rm(sourcePath, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts turns a data image preview into a ready artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-data-preview-"))
  try {
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: "![generated](data:image/png;base64,aW1hZ2U=)",
            },
          ],
        },
      ],
      "assistant-1",
      root,
    )
    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 1,
      materializedOrigins: origins,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(await readFile(path.join(root, "generated-001.png"), "utf8"), "image")
    assert.equal(bundle?.status, "ready")
    assert.equal(bundle?.items[0]?.origin, "assistant_preview")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts downloads an HTTPS image preview into the artifact bundle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-https-preview-"))
  try {
    let resolutions = 0
    const requests: Array<{ addresses: readonly string[]; url: string }> = []
    const fetcher = async (url: URL, addresses: readonly string[]) => {
      requests.push({ addresses, url: url.toString() })
      return new Response("remote-image", {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: "![generated](https://cdn.example.com/generated?id=1)",
            },
          ],
        },
      ],
      "assistant-1",
      root,
      {
        fetcher,
        resolveHostname: async () => {
          resolutions += 1
          return resolutions === 1 ? ["93.184.216.34"] : ["127.0.0.1"]
        },
      },
    )
    const bundle = await buildArtifactBundle({
      artifactRoot: root,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 1,
      materializedOrigins: origins,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(await readFile(path.join(root, "generated.png"), "utf8"), "remote-image")
    assert.equal(bundle?.status, "ready")
    assert.equal(bundle?.items[0]?.origin, "assistant_preview")
    assert.equal(resolutions, 1)
    assert.deepEqual(requests, [{ addresses: ["93.184.216.34"], url: "https://cdn.example.com/generated?id=1" }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("readResponseBodyWithinLimit cancels a response before buffering bytes over the limit", async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true
      },
      start: (controller) => {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.enqueue(new Uint8Array([5, 6, 7, 8]))
      },
    }),
  )

  assert.equal(await readResponseBodyWithinLimit(response, 5), null)
  assert.equal(cancelled, true)
})

test("materializeAssistantArtifacts refuses HTTPS image previews that resolve to private addresses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-private-preview-"))
  try {
    let requested = false
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: "![generated](https://internal.example/image.png)",
            },
          ],
        },
      ],
      "assistant-1",
      root,
      {
        fetcher: async () => {
          requested = true
          return new Response("image", { headers: { "content-type": "image/png" } })
        },
        resolveHostname: async () => ["127.0.0.1"],
      },
    )

    assert.equal(requested, false)
    assert.equal(origins.size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts rejects reserved and documentation address ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-reserved-preview-"))
  try {
    let requests = 0
    for (const address of ["198.18.0.1", "192.0.2.1", "2001:db8::1", "3fff::1"]) {
      const origins = await materializeAssistantArtifacts(
        [
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: 1,
            parts: [
              {
                kind: "text",
                partId: "text-1",
                text: "![generated](https://reserved.example/image.png)",
              },
            ],
          },
        ],
        "assistant-1",
        root,
        {
          fetcher: async () => {
            requests += 1
            return new Response("image", { headers: { "content-type": "image/png" } })
          },
          resolveHostname: async () => [address],
        },
      )
      assert.equal(origins.size, 0)
    }
    assert.equal(requests, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts bounds source count and download concurrency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-concurrency-preview-"))
  try {
    let activeRequests = 0
    let maxActiveRequests = 0
    let requestCount = 0
    let releaseRequests: () => void = () => undefined
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve
    })
    const materialization = materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: Array.from(
                { length: 40 },
                (_, index) => `![generated](https://cdn.example.com/image-${index + 1}.png)`,
              ).join("\n"),
            },
          ],
        },
      ],
      "assistant-1",
      root,
      {
        fetcher: async () => {
          requestCount += 1
          activeRequests += 1
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
          await requestGate
          activeRequests -= 1
          return new Response("image", { headers: { "content-type": "image/png" } })
        },
        resolveHostname: async () => ["93.184.216.34"],
      },
    )

    while (requestCount < 4) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    assert.equal(activeRequests, 4)
    releaseRequests()
    const origins = await materialization

    assert.equal(requestCount, 32)
    assert.equal(maxActiveRequests, 4)
    assert.equal(origins.size, 32)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializeAssistantArtifacts refuses redirects from public image URLs into private addresses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-private-redirect-"))
  try {
    let requests = 0
    const origins = await materializeAssistantArtifacts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              kind: "text",
              partId: "text-1",
              text: "![generated](https://cdn.example.com/image.png)",
            },
          ],
        },
      ],
      "assistant-1",
      root,
      {
        fetcher: async () => {
          requests += 1
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private.png" },
          })
        },
        resolveHostname: async () => ["93.184.216.34"],
      },
    )

    assert.equal(requests, 1)
    assert.equal(origins.size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("recoverMisplacedTurnArtifacts copies only files created or changed in old turn directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-recovery-"))
  try {
    const sessionRoot = path.join(root, "session-1")
    const oldTurn = path.join(sessionRoot, "old-turn")
    const currentTurn = path.join(sessionRoot, "current-turn")
    await mkdir(path.join(oldTurn, "nested"), { recursive: true })
    await mkdir(currentTurn)
    await writeFile(path.join(oldTurn, "unchanged.pdf"), "unchanged")
    await writeFile(path.join(oldTurn, "modified.xlsx"), "before")
    await writeFile(path.join(currentTurn, "report.pdf"), "current")

    const baseline = await captureArtifactSessionBaseline(sessionRoot, currentTurn)
    assert.ok(baseline)
    await writeFile(path.join(oldTurn, "modified.xlsx"), "after-with-a-different-size")
    await writeFile(path.join(oldTurn, "report.pdf"), "misplaced")
    await writeFile(path.join(oldTurn, "nested", "new.pdf"), "nested")

    const origins = await recoverMisplacedTurnArtifacts(baseline, currentTurn)
    const bundle = await buildArtifactBundle({
      artifactRoot: currentTurn,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      materializedOrigins: origins,
      messageId: "assistant-1",
      sessionId: "session-1",
    })

    assert.equal(await readFile(path.join(currentTurn, "modified.xlsx"), "utf8"), "after-with-a-different-size")
    assert.equal(await readFile(path.join(currentTurn, "report.pdf"), "utf8"), "current")
    assert.equal(await readFile(path.join(currentTurn, "report-2.pdf"), "utf8"), "misplaced")
    assert.equal(await readFile(path.join(currentTurn, "nested", "new.pdf"), "utf8"), "nested")
    assert.equal(
      bundle?.items.find((item) => item.name === "unchanged.pdf"),
      undefined,
    )
    assert.ok(bundle?.items.every((item) => item.origin === "recovered_output" || item.name === "report.pdf"))
    assert.equal(bundle?.items.find((item) => item.name === "new.pdf")?.origin, "recovered_output")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("artifact session recovery ignores symlinks and roots outside the captured session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-recovery-boundary-"))
  try {
    const sessionRoot = path.join(root, "session-1")
    const oldTurn = path.join(sessionRoot, "old-turn")
    const currentTurn = path.join(sessionRoot, "current-turn")
    const outside = path.join(root, "outside.pdf")
    await mkdir(oldTurn, { recursive: true })
    await mkdir(currentTurn)
    await writeFile(outside, "outside")

    const baseline = await captureArtifactSessionBaseline(sessionRoot, currentTurn)
    assert.ok(baseline)
    await symlink(outside, path.join(oldTurn, "linked.pdf"))

    const origins = await recoverMisplacedTurnArtifacts(baseline, currentTurn)

    assert.equal(origins.size, 0)
    assert.equal(await captureArtifactSessionBaseline(root, root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("ArtifactBundleStore round trips records and removes a session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-bundle-store-"))
  try {
    const artifactRoot = path.join(root, "artifacts")
    await mkdir(artifactRoot)
    await writeFile(path.join(artifactRoot, "report.pdf"), "pdf")
    const bundle = await buildArtifactBundle({
      artifactRoot,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      messageId: "assistant-1",
      sessionId: "session-1",
    })
    assert.ok(bundle)
    const store = new ArtifactBundleStore(root)
    const records = new Map()
    recordArtifactBundle(records, bundle)
    await store.write(records)

    assert.equal((await store.read()).get("session-1")?.get("assistant-1")?.items[0]?.name, "report.pdf")
    await store.removeSession("session-1")
    await store.record({ ...bundle, id: "bundle-2", messageId: "assistant-2", sessionId: "session-2" })

    const restored = await new ArtifactBundleStore(root).read()
    assert.equal(restored.has("session-1"), false)
    assert.equal(restored.get("session-2")?.has("assistant-2"), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
