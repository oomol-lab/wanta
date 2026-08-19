import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  ensureWindowsGptImage2RunnerCompatibility,
  patchWindowsGptImage2Runner,
} from "./gpt-image-2-windows-runtime-fix.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("GPT Image 2 Windows runtime compatibility", () => {
  it("hides runner children and accepts localized download output", () => {
    const patched = patchWindowsGptImage2Runner(
      ["const proc = spawn(command, cmdArgs, { env });", "const match = output.match(/Saved to:\\s*(.+)/);"].join("\n"),
    )

    expect(patched).toContain("spawn(command, cmdArgs, { env, windowsHide: true });")
    expect(patched).toContain("/(?:Saved to:|已保存到:|保存至:)\\s*(.+)/u")
  })

  it("patches only the private Windows runtime copy and is idempotent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-gpt-image-2-"))
    temporaryRoots.push(root)
    const skillPath = path.join(root, "gpt-image-2")
    const runner = path.join(skillPath, "scripts", "run_image.js")
    await mkdir(path.dirname(runner), { recursive: true })
    await writeFile(
      runner,
      "const proc = spawn(command, cmdArgs, { env });\nconst match = output.match(/Saved to:\\s*(.+)/);\n",
      "utf8",
    )

    await expect(ensureWindowsGptImage2RunnerCompatibility(skillPath, "win32")).resolves.toBe(true)
    await expect(ensureWindowsGptImage2RunnerCompatibility(skillPath, "win32")).resolves.toBe(false)
    await expect(readFile(runner, "utf8")).resolves.toContain("windowsHide: true")
  })

  it("leaves other platforms and skills unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-gpt-image-2-"))
    temporaryRoots.push(root)
    const otherSkillPath = path.join(root, "other-skill")
    const runner = path.join(otherSkillPath, "scripts", "run_image.js")
    const source = "const proc = spawn(command, cmdArgs, { env });\n"
    await mkdir(path.dirname(runner), { recursive: true })
    await writeFile(runner, source, "utf8")

    await expect(ensureWindowsGptImage2RunnerCompatibility(otherSkillPath, "win32")).resolves.toBe(false)
    await expect(ensureWindowsGptImage2RunnerCompatibility(otherSkillPath, "darwin")).resolves.toBe(false)
    await expect(readFile(runner, "utf8")).resolves.toBe(source)
  })
})
