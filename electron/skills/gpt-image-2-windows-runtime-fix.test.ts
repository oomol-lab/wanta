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

describe("GPT Image 2 Windows runtime compatibility", () => {
  it("adds idempotent guidance for supported raw oo team selection", () => {
    const source = "# GPT Image 2\n"
    const patched = patchGptImage2RuntimeInstructions(source)

    expect(patched).toContain("do not pass `--team`")
    expect(patched).toContain("`OO_TEAM_ID` or `OO_TEAM_NAME`")
    expect(patched).toContain("`oo team use` does not persist")
    expect(patched).toContain("Wanta local image delivery")
    expect(patched).toContain("use those saved local files for inline previews instead of matching `remote_urls`")
    expect(patched).toContain("one Markdown image per final image selected for inline display")
    expect(patched).toContain("Do not arbitrarily limit a multi-image result to its first path")
    expect(patched).toContain("Never add a leading slash such as `/C:/...`")
    expect(patchGptImage2RuntimeInstructions(patched)).toBe(patched)
  })

  it("hides runner children, accepts localized download output, and permits renamed runner files", () => {
    const patched = patchWindowsGptImage2Runner(
      [
        "const proc = spawn(command, cmdArgs, { env });",
        "const match = output.match(/Saved to:\\s*(.+)/);",
        "if (",
        '    typeof first === "string" &&',
        '    first.endsWith(".js") &&',
        '    path.basename(first) === "run_image.js"',
        "  ) {",
      ].join("\n"),
    )

    expect(patched).toContain("spawn(command, cmdArgs, { env, windowsHide: true });")
    expect(patched).toContain("/(?:Saved to|已保存到|保存至)\\s*[:：]\\s*(.+)/u")
    expect(patched).toContain('if (typeof first === "string" && first.endsWith(".js")) {')
    expect(patched).not.toContain('path.basename(first) === "run_image.js"')
  })

  it("upgrades the previous localized download parser", () => {
    const patched = patchWindowsGptImage2Runner(
      "const match = output.match(/(?:Saved to:|已保存到[:：]|保存至[:：])\\s*(.+)/u);",
    )

    expect(patched).toContain("/(?:Saved to|已保存到|保存至)\\s*[:：]\\s*(.+)/u")
    expect(patchWindowsGptImage2Runner(patched)).toBe(patched)
  })

  it("patches only the private Windows runtime copy and is idempotent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-gpt-image-2-"))
    temporaryRoots.push(root)
    const skillPath = path.join(root, "gpt-image-2")
    const runner = path.join(skillPath, "scripts", "run_image.js")
    await mkdir(path.dirname(runner), { recursive: true })
    await writeFile(
      runner,
      [
        "const proc = spawn(command, cmdArgs, { env });",
        "const match = output.match(/Saved to:\\s*(.+)/);",
        "if (",
        '    typeof first === "string" &&',
        '    first.endsWith(".js") &&',
        '    path.basename(first) === "run_image.js"',
        "  ) {",
      ].join("\n"),
      "utf8",
    )

    await writeFile(path.join(skillPath, "SKILL.md"), "# GPT Image 2\n", "utf8")

    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "win32")).resolves.toBe(true)
    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "win32")).resolves.toBe(false)
    await expect(readFile(runner, "utf8")).resolves.toContain("windowsHide: true")
    await expect(readFile(runner, "utf8")).resolves.not.toContain('path.basename(first) === "run_image.js"')
    await expect(readFile(path.join(skillPath, "SKILL.md"), "utf8")).resolves.toContain(
      "`OO_TEAM_ID` or `OO_TEAM_NAME`",
    )
    await expect(readFile(path.join(skillPath, "SKILL.md"), "utf8")).resolves.toContain(
      "one Markdown image per final image selected for inline display",
    )
  })

  it("replaces the obsolete first-image-only runtime override with ordered local delivery", () => {
    const patched = patchGptImage2RuntimeInstructions(
      [
        "# GPT Image 2",
        "",
        "<!-- wanta-gpt-image-2-local-image-display:start -->",
        "Use the first path only.",
        "<!-- wanta-gpt-image-2-local-image-display:end -->",
      ].join("\n"),
    )

    expect(patched).not.toContain("Use the first path only")
    expect(patched).toContain("Do not arbitrarily limit a multi-image result to its first path")
    expect(patched.match(/wanta-gpt-image-2-local-image-display:start/g)).toHaveLength(1)
    expect(patched.match(/wanta-gpt-image-2-local-image-display:end/g)).toHaveLength(1)
  })

  it("applies team guidance on every platform but leaves non-Windows runners unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-gpt-image-2-"))
    temporaryRoots.push(root)
    const otherSkillPath = path.join(root, "other-skill")
    const runner = path.join(otherSkillPath, "scripts", "run_image.js")
    const source = "const proc = spawn(command, cmdArgs, { env });\n"
    await mkdir(path.dirname(runner), { recursive: true })
    await writeFile(runner, source, "utf8")

    await expect(ensureGptImage2RuntimeCompatibility(otherSkillPath, "win32")).resolves.toBe(false)
    await expect(ensureGptImage2RuntimeCompatibility(otherSkillPath, "darwin")).resolves.toBe(false)
    await expect(readFile(runner, "utf8")).resolves.toBe(source)

    const skillPath = path.join(root, "gpt-image-2")
    const skillRunner = path.join(skillPath, "scripts", "run_image.js")
    await mkdir(path.dirname(skillRunner), { recursive: true })
    await writeFile(skillRunner, source, "utf8")
    await writeFile(path.join(skillPath, "SKILL.md"), "# GPT Image 2\n", "utf8")

    await expect(ensureGptImage2RuntimeCompatibility(skillPath, "darwin")).resolves.toBe(true)
    await expect(readFile(skillRunner, "utf8")).resolves.toBe(source)
    await expect(readFile(path.join(skillPath, "SKILL.md"), "utf8")).resolves.toContain("do not pass `--team`")
  })
})
