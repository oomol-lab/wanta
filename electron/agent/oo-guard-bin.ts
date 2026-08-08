import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface OoGuardCommandBinOptions {
  binDir: string
  nodeBin: string
  ooGuardCliPath: string
  platform?: NodeJS.Platform
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function ensureOoGuardCommandBin({
  binDir,
  nodeBin,
  ooGuardCliPath,
  platform = process.platform,
}: OoGuardCommandBinOptions): Promise<string> {
  await mkdir(binDir, { recursive: true })
  if (platform === "win32") {
    await writeFile(
      path.join(binDir, "oo.cmd"),
      ["@echo off", "set ELECTRON_RUN_AS_NODE=1", `"${nodeBin}" "${ooGuardCliPath}" %*`, ""].join("\r\n"),
      "utf8",
    )
    return binDir
  }

  const commandPath = path.join(binDir, "oo")
  await writeFile(
    commandPath,
    [
      "#!/bin/sh",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellQuote(nodeBin)} ${shellQuote(ooGuardCliPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  )
  await chmod(commandPath, 0o755)
  return binDir
}
