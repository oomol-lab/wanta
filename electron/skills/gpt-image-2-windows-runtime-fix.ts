import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const gptImage2SkillId = "gpt-image-2"
const runnerPath = path.join("scripts", "run_image.js")
const skillInstructionsPath = "SKILL.md"
const teamScopeInstructionsStart = "<!-- wanta-gpt-image-2-team-scope:start -->"
const teamScopeInstructionsEnd = "<!-- wanta-gpt-image-2-team-scope:end -->"
const localImageDisplayInstructionsStart = "<!-- wanta-gpt-image-2-local-image-display:start -->"
const localImageDisplayInstructionsEnd = "<!-- wanta-gpt-image-2-local-image-display:end -->"

const teamScopeInstructions = [
  teamScopeInstructionsStart,
  "## Wanta oo CLI team scope",
  "",
  "For direct raw `oo` commands used by this GPT Image 2 runner, do not pass `--team`; the bundled oo CLI does not support that global flag.",
  "When authentication uses `OO_API_KEY`, `oo team use` does not persist a default team. Set `OO_TEAM_ID` or `OO_TEAM_NAME` in the environment for that command instead.",
  "This guidance applies to direct `oo` calls only and does not change Wanta-managed connector workspace selection.",
  teamScopeInstructionsEnd,
].join("\n")

/**
 * The default GPT Image 2 runner starts short-lived `oo` commands while a
 * Windows agent turn is running. Keep the consoles hidden, accept localized
 * download messages, and keep copied runner files executable.
 */
export function patchWindowsGptImage2Runner(source: string): string {
  return source
    .replace("spawn(command, cmdArgs, { env });", "spawn(command, cmdArgs, { env, windowsHide: true });")
    .replace("output.match(/Saved to:\\s*(.+)/);", "output.match(/(?:Saved to:|已保存到[:：]|保存至[:：])\\s*(.+)/u);")
    .replace(
      [
        "if (",
        '    typeof first === "string" &&',
        '    first.endsWith(".js") &&',
        '    path.basename(first) === "run_image.js"',
        "  ) {",
      ].join("\n"),
      'if (typeof first === "string" && first.endsWith(".js")) {',
    )
}

/** Adds Wanta-specific, supported team-selection guidance to the private skill copy. */
export function patchGptImage2RuntimeInstructions(source: string): string {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n"
  return appendRuntimeInstructions(
    removeRuntimeInstructions(source, localImageDisplayInstructionsStart, localImageDisplayInstructionsEnd),
    teamScopeInstructionsStart,
    teamScopeInstructionsEnd,
    teamScopeInstructions,
    lineEnding,
  )
}

function removeRuntimeInstructions(source: string, start: string, end: string): string {
  return source.replace(new RegExp(`${start}[\\s\\S]*?${end}(?:\\r?\\n)?`, "u"), "")
}

function appendRuntimeInstructions(
  source: string,
  start: string,
  end: string,
  instructions: string,
  lineEnding: string,
): string {
  const blockPattern = new RegExp(`${start}[\\s\\S]*?${end}(?:\\r?\\n)?`, "u")
  const withoutExistingInstructions = source
    .replace(blockPattern, "")
    .replace(/(?:\r?\n){3,}/gu, `${lineEnding}${lineEnding}`)
    .trimEnd()
  return `${withoutExistingInstructions}${lineEnding}${lineEnding}${instructions.replaceAll("\n", lineEnding)}${lineEnding}`
}

async function patchInstructions(skillPath: string): Promise<boolean> {
  const filePath = path.join(skillPath, skillInstructionsPath)
  let source: string
  try {
    source = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }
  const patched = patchGptImage2RuntimeInstructions(source)
  if (patched === source) {
    return false
  }
  await writeFile(filePath, patched, "utf8")
  return true
}

/** Applies the compatibility fix only to Wanta's private runtime copy. */
export async function ensureGptImage2RuntimeCompatibility(
  skillPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (path.basename(skillPath) !== gptImage2SkillId) {
    return false
  }

  const instructionsPatched = await patchInstructions(skillPath)
  if (platform !== "win32") {
    return instructionsPatched
  }

  const filePath = path.join(skillPath, runnerPath)
  let source: string
  try {
    source = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return instructionsPatched
    }
    throw error
  }

  const patched = patchWindowsGptImage2Runner(source)
  if (patched === source) {
    return instructionsPatched
  }

  await writeFile(filePath, patched, "utf8")
  return true
}
