import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface DirectCliCommandBinOptions {
  binDir: string
  dingTalkCliBinPath?: string
  larkCliBinPath?: string
  platform?: NodeJS.Platform
  wecomCliBinPath?: string
}

interface DirectCliCommand {
  binaryPath?: string
  command: string
  provider: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function disconnectedMessage(provider: string, command: string): string {
  return `Wanta: ${provider} is not connected. Connect it in Settings before using ${command}.`
}

export async function ensureDirectCliCommandBin({
  binDir,
  dingTalkCliBinPath,
  larkCliBinPath,
  platform = process.platform,
  wecomCliBinPath,
}: DirectCliCommandBinOptions): Promise<string> {
  await mkdir(binDir, { recursive: true })
  const commands: DirectCliCommand[] = [
    { binaryPath: larkCliBinPath, command: "lark-cli", provider: "Lark CLI" },
    { binaryPath: wecomCliBinPath, command: "wecom-cli", provider: "WeCom CLI" },
    { binaryPath: dingTalkCliBinPath, command: "dws", provider: "DingTalk CLI" },
  ]

  await Promise.all(commands.map((command) => writeDirectCliCommand(binDir, command, platform)))
  return binDir
}

async function writeDirectCliCommand(
  binDir: string,
  { binaryPath, command, provider }: DirectCliCommand,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") {
    const source = binaryPath
      ? ["@echo off", `"${binaryPath}" %*`, "exit /b %errorlevel%", ""]
      : ["@echo off", `echo ${disconnectedMessage(provider, command)} 1^>^&2`, "exit /b 69", ""]
    await writeFile(path.join(binDir, `${command}.cmd`), source.join("\r\n"), "utf-8")
    return
  }

  const source = binaryPath
    ? ["#!/bin/sh", `exec ${shellQuote(binaryPath)} "$@"`, ""]
    : ["#!/bin/sh", `echo ${shellQuote(disconnectedMessage(provider, command))} >&2`, "exit 69", ""]
  const commandPath = path.join(binDir, command)
  await writeFile(commandPath, source.join("\n"), "utf-8")
  await chmod(commandPath, 0o755)
}
