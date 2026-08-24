import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { rolldown } from "rolldown"

const require = createRequire(import.meta.url)

interface ClaudeAgentAcpManifest {
  version: string
}

export interface BundledClaudeAgentAcp {
  entryPath: string
  scriptPath: string
  version: string
}

function claudeAgentAcpPackageRoot(): string {
  return path.dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json"))
}

/** Bundle the pinned Claude ACP bridge and its JS dependencies into Resources/bin. */
export async function bundleClaudeAgentAcp(
  destinationDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<BundledClaudeAgentAcp> {
  const packageRoot = claudeAgentAcpPackageRoot()
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as ClaudeAgentAcpManifest
  const sourceScript = path.join(packageRoot, "dist", "index.js")
  const scriptPath = path.join(destinationDirectory, "claude-agent-acp.mjs")
  const entryPath = path.join(destinationDirectory, platform === "win32" ? "claude-agent-acp.cmd" : "claude-agent-acp")

  mkdirSync(destinationDirectory, { recursive: true })
  const build = await rolldown({ input: sourceScript, platform: "node" })
  try {
    await build.write({ file: scriptPath, format: "esm", codeSplitting: false })
  } finally {
    await build.close()
  }

  if (platform === "win32") {
    writeFileSync(
      entryPath,
      [
        "@echo off",
        "if defined WANTA_NODE_RUNTIME goto wanta_node",
        'node "%~dp0claude-agent-acp.mjs" %*',
        "exit /b %ERRORLEVEL%",
        ":wanta_node",
        "set ELECTRON_RUN_AS_NODE=1",
        '"%WANTA_NODE_RUNTIME%" "%~dp0claude-agent-acp.mjs" %*',
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
    )
  } else {
    writeFileSync(
      entryPath,
      [
        "#!/bin/sh",
        'script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
        "node_runtime=${WANTA_NODE_RUNTIME:-node}",
        'ELECTRON_RUN_AS_NODE=1 exec "$node_runtime" "$script_dir/claude-agent-acp.mjs" "$@"',
        "",
      ].join("\n"),
    )
    chmodSync(entryPath, 0o755)
  }

  return { entryPath, scriptPath, version: manifest.version }
}
