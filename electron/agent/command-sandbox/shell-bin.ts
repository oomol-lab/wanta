import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface CommandSandboxShellBinOptions {
  binDir: string
  cliPath: string
  nodeBin: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function ensureCommandSandboxShellBin({
  binDir,
  cliPath,
  nodeBin,
}: CommandSandboxShellBinOptions): Promise<string> {
  await mkdir(binDir, { recursive: true })
  const commandPath = path.join(binDir, "wanta-command-shell")
  await writeFile(
    commandPath,
    ["#!/bin/sh", "export ELECTRON_RUN_AS_NODE=1", `exec ${shellQuote(nodeBin)} ${shellQuote(cliPath)} "$@"`, ""].join(
      "\n",
    ),
    "utf8",
  )
  await chmod(commandPath, 0o755)
  return commandPath
}
