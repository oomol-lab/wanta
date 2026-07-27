import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface WikiGraphCommandBinOptions {
  binDir: string
  nodeBin: string
  stateDir: string
  wikiGraphCliPath: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function ensureWikiGraphCommandBin({
  binDir,
  nodeBin,
  stateDir,
  wikiGraphCliPath,
}: WikiGraphCommandBinOptions): Promise<string> {
  await mkdir(binDir, { recursive: true })
  if (process.platform === "win32") {
    const commandPath = path.join(binDir, "wg.cmd")
    await writeFile(
      commandPath,
      [
        "@echo off",
        "set ELECTRON_RUN_AS_NODE=1",
        `"${nodeBin}" "${wikiGraphCliPath}" --wanta-state-dir "${stateDir}" -- %*`,
        "",
      ].join("\r\n"),
      "utf-8",
    )
    return binDir
  }

  const commandPath = path.join(binDir, "wg")
  await writeFile(
    commandPath,
    [
      "#!/bin/sh",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellQuote(nodeBin)} ${shellQuote(wikiGraphCliPath)} --wanta-state-dir ${shellQuote(stateDir)} -- "$@"`,
      "",
    ].join("\n"),
    "utf-8",
  )
  await chmod(commandPath, 0o755)
  return binDir
}
