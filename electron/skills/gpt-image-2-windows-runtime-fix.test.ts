import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  ensureGptImage2RuntimeCompatibility,
  patchGptImage2RuntimeInstructions,
  patchWindowsGptImage2Runner,
} from "./gpt-image-2-windows-runtime-fix.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function legacyRunnerSource(): string {
  return [
    "const proc = spawn(command, cmdArgs, { env });",
    "const match = output.match(/Saved to:\\s*(.+)/);",
    "if (",
    '    typeof first === "string" &&',
    '    first.endsWith(".js") &&',
    '    path.basename(first) === "run_image.js"',
    "  ) {",
  ].join("\n")
}

async function createSkill(version: string, runnerSource = legacyRunnerSource()) {
  const root = await mkdtemp(path.join(tmpdir(), "wanta-gpt-image-2-"))
  temporaryRoots.push(root)
  const skillPath = path.join(root, "gpt-image-2")
  const runner = path.join(skillPath, "scripts", "run_image.js")
  await mkdir(path.dirname(runner), { recursive: true })
  await writeFile(runner, runnerSource, "utf8")
  await writeFile(
    path.join(skillPath, "SKILL.md"),
    [
      "---",
      "name: gpt-image-2",
      `metadata: { version: ${version} }`,
      `version: ${version}`,
      "---",
      "# GPT Image 2",
      "",
      "<!-- wanta-gpt-image-2-local-image-display:start -->",
      "Duplicate local image delivery guidance.",
      "<!-- wanta-gpt-image-2-local-image-display:end -->",
    ].join("\n"),
    "utf8",
  )
  return { runner, skillPath }
}

describe("GPT Image 2 runtime compatibility", () => {
  it("keeps Wanta team guidance but removes the obsolete local-image injection", () => {
    const source = [
      "# GPT Image 2",
      "",
      "<!-- wanta-gpt-image-2-local-image-display:start -->",
      "Duplicate local image delivery guidance.",
      "<!-- wanta-gpt-image-2-local-image-display:end -->",
    ].join("\n")
    const patched = patchGptImage2RuntimeInstructions(source)

    expect(patched).toContain("do not pass `--team`")
    expect(patched).toContain("`OO_TEAM_ID` or `OO_TEAM_NAME`")
    expect(patched).not.toContain("Wanta local image delivery")
    expect(patched).not.toContain("Duplicate local image delivery guidance")
    expect(patchGptImage2RuntimeInstructions(patched)).toBe(patched)
  })

  it("retains the legacy Windows runner repair for versions below 1.1.2", async () => {
    const { runner, skillPath } = await createSkill("1.1.1")

    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "win32")).resolves.toBe(true)
    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "win32")).resolves.toBe(false)
    await expect(readFile(runner, "utf8")).resolves.toContain("windowsHide: true")
    await expect(readFile(runner, "utf8")).resolves.toContain("/(?:Saved to|已保存到|保存至)\\s*[:：]\\s*(.+)/u")
  })

  it("does not rewrite the native runner in version 1.1.2 or newer", async () => {
    const source = legacyRunnerSource()
    const { runner, skillPath } = await createSkill("1.1.2", source)

    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "win32")).resolves.toBe(true)
    await expect(readFile(runner, "utf8")).resolves.toBe(source)
    await expect(readFile(path.join(skillPath, "SKILL.md"), "utf8")).resolves.not.toContain(
      "Duplicate local image delivery guidance",
    )
  })

  it("leaves runners unchanged outside Windows", async () => {
    const source = legacyRunnerSource()
    const { runner, skillPath } = await createSkill("1.1.1", source)

    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "darwin")).resolves.toBe(true)
    await expect(readFile(runner, "utf8")).resolves.toBe(source)
  })

  it("ignores unrelated skill directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-other-skill-"))
    temporaryRoots.push(root)
    await expect(ensureGptImage2RuntimeCompatibility(path.join(root, "other-skill"), "win32")).resolves.toBe(false)
  })

  it("upgrades old runner source idempotently", () => {
    const patched = patchWindowsGptImage2Runner(legacyRunnerSource())

    expect(patched).toContain("spawn(command, cmdArgs, { env, windowsHide: true });")
    expect(patched).toContain("/(?:Saved to|已保存到|保存至)\\s*[:：]\\s*(.+)/u")
    expect(patched).toContain('if (typeof first === "string" && first.endsWith(".js")) {')
    expect(patchWindowsGptImage2Runner(patched)).toBe(patched)
  })
})
