import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

interface CodexAcpManifest {
  version: string
}

export interface BundledCodexAcp {
  entryPath: string
  scriptPath: string
  version: string
}

function codexAcpPackageRoot(): string {
  return path.dirname(require.resolve("@agentclientprotocol/codex-acp/package.json"))
}

export function bundleCodexAcp(
  destinationDirectory: string,
  platform: NodeJS.Platform = process.platform,
): BundledCodexAcp {
  const packageRoot = codexAcpPackageRoot()
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as CodexAcpManifest
  const sourceScript = path.join(packageRoot, "dist", "index.js")
  const scriptPath = path.join(destinationDirectory, "codex-acp.js")
  const entryPath = path.join(destinationDirectory, platform === "win32" ? "codex-acp.cmd" : "codex-acp")

  mkdirSync(destinationDirectory, { recursive: true })
  copyFileSync(sourceScript, scriptPath)

  if (platform === "win32") {
    writeFileSync(
      entryPath,
      [
        "@echo off",
        "if defined WANTA_NODE_RUNTIME goto wanta_node",
        'node "%~dp0codex-acp.js" %*',
        "exit /b %ERRORLEVEL%",
        ":wanta_node",
        "set ELECTRON_RUN_AS_NODE=1",
        '"%WANTA_NODE_RUNTIME%" "%~dp0codex-acp.js" %*',
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
        'node_runtime=${WANTA_NODE_RUNTIME:-node}',
        'ELECTRON_RUN_AS_NODE=1 exec "$node_runtime" "$script_dir/codex-acp.js" "$@"',
        "",
      ].join("\n"),
    )
    chmodSync(entryPath, 0o755)
  }

  return { entryPath, scriptPath, version: manifest.version }
}
