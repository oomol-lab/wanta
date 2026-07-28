import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const pluginSource = `
export default async ({ client }) => ({
  "shell.env": async (input, output) => {
    if (!input.sessionID || !input.callID) return
    let policySessionID = input.sessionID
    const visited = new Set()
    while (!visited.has(policySessionID)) {
      visited.add(policySessionID)
      const result = await client.session.get({ path: { id: policySessionID } })
      const parentID = result.data?.parentID
      if (!parentID) break
      policySessionID = parentID
    }
    output.env.WANTA_COMMAND_SANDBOX_SESSION_ID = policySessionID
    output.env.WANTA_COMMAND_SANDBOX_CALL_ID = input.callID
  },
})
`.trimStart()

export async function ensureCommandSandboxPlugin(runtimeDir: string): Promise<string> {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
  const pluginPath = path.join(runtimeDir, "command-sandbox-plugin.mjs")
  await writeFile(pluginPath, pluginSource, { encoding: "utf8", mode: 0o600 })
  await chmod(pluginPath, 0o600)
  return pathToFileURL(pluginPath).href
}
