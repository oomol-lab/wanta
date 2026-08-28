import type { WorkspaceTeamScope } from "../oo-guard-core.ts"

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { prepareManagedExternalOoCommand, validateManagedDownloadUrl } from "./oo-command-safety.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function fixture(runtime: "none" | "oomol" | "openconnector" = "oomol") {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-command-safety-"))
  roots.push(temporaryRoot)
  const root = await realpath(temporaryRoot)
  const cwd = path.join(root, "process")
  const artifacts = path.join(root, "artifacts")
  await Promise.all([mkdir(cwd), mkdir(artifacts)])
  const scope: WorkspaceTeamScope = {
    external: true,
    runtime,
    sessionCwdRoots: { "session-a": [root] },
    sessionRuntimes: { "session-a": runtime },
    sessionTeams: { "session-a": runtime === "oomol" ? "Team A" : "" },
  }
  return { artifacts, binding: { cwd, sessionId: "session-a" }, cwd, root, scope }
}

describe("managed OO command safety", () => {
  test("canonicalizes managed uploads and rejects reads outside the turn", async () => {
    const { binding, cwd, root, scope } = await fixture()
    const input = path.join(cwd, "input.txt")
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`)
    await Promise.all([writeFile(input, "ok"), writeFile(outside, "no")])
    roots.push(outside)

    await expect(
      prepareManagedExternalOoCommand(["file", "upload", "input.txt", "--json"], binding, scope),
    ).resolves.toEqual(["file", "upload", input, "--json"])
    await expect(
      prepareManagedExternalOoCommand(["file", "upload", outside, "--json"], binding, scope),
    ).rejects.toThrow(/outside the active turn/u)
    const missing = path.join(cwd, "private-missing-name.txt")
    await expect(
      prepareManagedExternalOoCommand(["file", "upload", missing, "--json"], binding, scope),
    ).rejects.toThrow("Wanta managed OO file input must be an existing file inside the active turn's directories.")
    const missingError = await prepareManagedExternalOoCommand(
      ["file", "upload", missing, "--json"],
      binding,
      scope,
    ).catch((error: unknown) => error)
    expect(missingError).toBeInstanceOf(Error)
    expect((missingError as Error).message).not.toContain(missing)
  })

  test("pins downloads to managed output directories and blocks local targets", async () => {
    const { artifacts, binding, cwd, scope } = await fixture("none")
    await expect(
      prepareManagedExternalOoCommand(
        ["file", "download", "https://93.184.216.34/report", artifacts, "--name", "report", "--ext", "pdf"],
        binding,
        scope,
      ),
    ).resolves.toEqual([
      "file",
      "download",
      "https://93.184.216.34/report",
      artifacts,
      "--name",
      "report",
      "--ext",
      "pdf",
    ])
    await expect(
      prepareManagedExternalOoCommand(["file", "download", "http://127.0.0.1/private"], binding, scope),
    ).rejects.toThrow(/local network|private/u)
    await expect(
      prepareManagedExternalOoCommand(["file", "download", "http://[::ffff:7f00:1]/private"], binding, scope),
    ).rejects.toThrow(/private/u)
    await expect(
      prepareManagedExternalOoCommand(["file", "download", "https://93.184.216.34/report"], binding, scope),
    ).resolves.toContain(cwd)
  })

  test("rejects a download directory that escapes through a symlink", async () => {
    const { binding, root, scope } = await fixture()
    const outside = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-command-outside-"))
    roots.push(outside)
    await symlink(outside, path.join(root, "escape"))
    await expect(
      prepareManagedExternalOoCommand(
        ["file", "download", "https://93.184.216.34/report", path.join(root, "escape", "nested")],
        binding,
        scope,
      ),
    ).rejects.toThrow(/outside the active turn/u)
  })

  test("requires OOMOL and explicit project binding for Flow", async () => {
    const { binding, scope } = await fixture()
    await expect(
      prepareManagedExternalOoCommand(["flow", "project", "current", "--json"], binding, scope),
    ).resolves.toEqual(["flow", "project", "current", "--json"])
    await expect(
      prepareManagedExternalOoCommand(["flow", "inspect", "demo", "--json"], binding, scope),
    ).rejects.toThrow(/explicit --project/u)
    await expect(
      prepareManagedExternalOoCommand(["flow", "inspect", "demo", "--project", "project-a", "--json"], binding, scope),
    ).resolves.toEqual(["flow", "inspect", "demo", "--project", "project-a", "--json"])

    const openConnector = await fixture("openconnector")
    await expect(
      prepareManagedExternalOoCommand(
        ["flow", "inspect", "demo", "--project", "project-a"],
        openConnector.binding,
        openConnector.scope,
      ),
    ).rejects.toThrow(/active OOMOL workspace/u)
  })

  test("canonicalizes Flow file references and rejects stdin", async () => {
    const { binding, cwd, scope } = await fixture()
    const request = path.join(cwd, "request.json")
    await writeFile(request, "{}")
    await expect(
      prepareManagedExternalOoCommand(
        ["flow", "apply", "demo", "--project", "project-a", "--file", "request.json", "--json"],
        binding,
        scope,
      ),
    ).resolves.toContain(request)
    await expect(
      prepareManagedExternalOoCommand(
        ["flow", "apply", "demo", "--project", "project-a", "--file", "-", "--json"],
        binding,
        scope,
      ),
    ).rejects.toThrow(/do not accept stdin/u)
  })

  test("validates nested @file references inside Flow apply requests", async () => {
    const { binding, cwd, root, scope } = await fixture()
    const code = path.join(cwd, "transform.js")
    const request = path.join(cwd, "request.json")
    await writeFile(code, "export function run() {}")
    await writeFile(request, JSON.stringify({ nodes: { transform: { code: "@transform.js" } }, version: 1 }))
    await expect(
      prepareManagedExternalOoCommand(
        ["flow", "apply", "demo", "--project", "project-a", "--file", request],
        binding,
        scope,
      ),
    ).resolves.toContain(request)

    const outside = path.join(path.dirname(root), `${path.basename(root)}-secret.txt`)
    await writeFile(outside, "secret")
    roots.push(outside)
    await writeFile(request, JSON.stringify({ nodes: { transform: { code: `@${outside}` } }, version: 1 }))
    await expect(
      prepareManagedExternalOoCommand(
        ["flow", "apply", "demo", "--project", "project-a", "--file", request],
        binding,
        scope,
      ),
    ).rejects.toThrow(/outside the active turn/u)
  })

  test("rejects hostnames resolving to private addresses", async () => {
    await expect(
      validateManagedDownloadUrl("https://artifact.example.test/file", async () => [
        { address: "10.0.0.8", family: 4 },
      ]),
    ).rejects.toThrow(/private/u)
    await expect(
      validateManagedDownloadUrl("https://artifact.example.test/file", async () => [{ address: "8.8.8.8", family: 4 }]),
    ).resolves.toBe("https://artifact.example.test/file")
    await expect(
      validateManagedDownloadUrl("https://artifact.example.test/file", async () => [
        { address: "203.0.114.8", family: 4 },
      ]),
    ).resolves.toBe("https://artifact.example.test/file")
  })
})
