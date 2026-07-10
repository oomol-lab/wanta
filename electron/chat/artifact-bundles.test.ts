import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  ArtifactBundleStore,
  buildArtifactBundle,
  generatedImagePreviewCount,
  markdownImageCount,
  materializeAssistantArtifacts,
  recordArtifactBundle,
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

test("buildArtifactBundle marks an incompletely persisted image set as partial", async () => {
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
    assert.equal(bundle?.failure, "generated_preview_not_persisted")
    assert.deepEqual(
      bundle?.items.map((item) => item.name),
      ["001.png"],
    )
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
    const fetcher = async () =>
      new Response("remote-image", {
        status: 200,
        headers: { "content-type": "image/png" },
      })
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
        resolveHostname: async () => ["93.184.216.34"],
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
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
    assert.equal((await store.read()).has("session-1"), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
