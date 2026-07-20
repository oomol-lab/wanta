import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "rolldown"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")

export const bundledAgentToolRuntimeDir = path.join(repoRoot, "resources", "agent-tool-runtime")
export const bundledAgentToolRuntimePath = path.join(bundledAgentToolRuntimeDir, "tool.js")

export async function buildAgentToolRuntime(): Promise<string> {
  await mkdir(bundledAgentToolRuntimeDir, { recursive: true })
  await build({
    input: path.join(dirname, "agent-tool-runtime-entry.ts"),
    output: {
      file: bundledAgentToolRuntimePath,
      format: "esm",
      minify: true,
    },
  })
  console.log(`[wanta] bundled agent tool runtime: ${path.relative(repoRoot, bundledAgentToolRuntimePath)}`)
  return bundledAgentToolRuntimePath
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildAgentToolRuntime()
}
