import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const gptImage2SkillId = "gpt-image-2"
const runnerPath = path.join("scripts", "run_image.js")

/**
 * The default GPT Image 2 runner starts short-lived `oo` commands while a
 * Windows agent turn is running.  Keep the consoles hidden and accept the
 * localized success message emitted by the CLI on Chinese Windows installs.
 */
export function patchWindowsGptImage2Runner(source: string): string {
  return source
    .replace("spawn(command, cmdArgs, { env });", "spawn(command, cmdArgs, { env, windowsHide: true });")
    .replace("output.match(/Saved to:\\s*(.+)/);", "output.match(/(?:Saved to:|已保存到:|保存至:)\\s*(.+)/u);")
}

/** Applies the compatibility fix only to Wanta's private runtime copy. */
export async function ensureWindowsGptImage2RunnerCompatibility(
  skillPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== "win32" || path.basename(skillPath) !== gptImage2SkillId) {
    return false
  }

  const filePath = path.join(skillPath, runnerPath)
  let source: string
  try {
    source = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }

  const patched = patchWindowsGptImage2Runner(source)
  if (patched === source) {
    return false
  }

  await writeFile(filePath, patched, "utf8")
  return true
}
