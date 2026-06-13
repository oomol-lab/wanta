import type { ExecFileOptions, SpawnOptions } from "node:child_process"

import { execFile, spawn } from "node:child_process"
import { access, realpath } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { getOoPath } from "../oo-command.ts"

const execFileAsync = promisify(execFile)

export interface EditorCommand {
  args: string[]
  command: string
}

export type SkillEditorAppId =
  | "vscode"
  | "cursor"
  | "windsurf"
  | "trae"
  | "qoder"
  | "antigravity"
  | "zed"
  | "vscode-insiders"
  | "codium"
  | "sublime"
  | "webstorm"
  | "idea"
  | "system"

export interface SkillEditorApp {
  available: boolean
  id: SkillEditorAppId
  isDefault: boolean
  name: string
}

interface ExecFileOutput {
  stderr: string | Buffer
  stdout: string | Buffer
}

type ExecFileAsync = (command: string, args: string[], options: ExecFileOptions) => Promise<ExecFileOutput>
type AccessPath = (pathname: string) => Promise<void>
type RealpathPath = (pathname: string) => Promise<string>
type SpawnProcess = {
  on(event: "error", listener: (cause: Error) => void): SpawnProcess
  on(event: "spawn", listener: () => void): SpawnProcess
  unref(): void
}
type SpawnEditor = (command: string, args: string[], options: SpawnOptions) => SpawnProcess

interface ResolveEditorCommandOptions {
  accessPath?: AccessPath
  editorId?: SkillEditorAppId
  env?: NodeJS.ProcessEnv
  execFile?: ExecFileAsync
  platform?: NodeJS.Platform
  realpathPath?: RealpathPath
}

interface EditorCandidate {
  commands: EditorCommand[]
  id: Exclude<SkillEditorAppId, "system">
  macosAppNames?: string[]
  name: string
}

const editorProbeTimeoutMs = 1_500
const editorSpawnTimeoutMs = 1_500

const editorCandidates: EditorCandidate[] = [
  {
    commands: [{ command: "code", args: ["--reuse-window"] }],
    id: "vscode",
    macosAppNames: ["Visual Studio Code"],
    name: "VS Code",
  },
  {
    commands: [{ command: "cursor", args: ["--reuse-window"] }],
    id: "cursor",
    macosAppNames: ["Cursor"],
    name: "Cursor",
  },
  {
    commands: [{ command: "windsurf", args: ["--reuse-window"] }],
    id: "windsurf",
    macosAppNames: ["Windsurf"],
    name: "Windsurf",
  },
  {
    commands: [{ command: "trae", args: ["--reuse-window"] }],
    id: "trae",
    macosAppNames: ["Trae"],
    name: "Trae",
  },
  {
    commands: [{ command: "qoder", args: ["--reuse-window"] }],
    id: "qoder",
    macosAppNames: ["Qoder"],
    name: "Qoder",
  },
  {
    commands: [{ command: "antigravity", args: ["--reuse-window"] }],
    id: "antigravity",
    macosAppNames: ["Antigravity"],
    name: "Antigravity",
  },
  {
    commands: [{ command: "zed", args: [] }],
    id: "zed",
    macosAppNames: ["Zed"],
    name: "Zed",
  },
  {
    commands: [{ command: "code-insiders", args: ["--reuse-window"] }],
    id: "vscode-insiders",
    macosAppNames: ["Visual Studio Code - Insiders"],
    name: "VS Code Insiders",
  },
  {
    commands: [{ command: "codium", args: ["--reuse-window"] }],
    id: "codium",
    macosAppNames: ["VSCodium"],
    name: "VSCodium",
  },
  {
    commands: [{ command: "subl", args: [] }],
    id: "sublime",
    macosAppNames: ["Sublime Text"],
    name: "Sublime Text",
  },
  {
    commands: [
      { command: "webstorm", args: [] },
      { command: "/Applications/WebStorm.app/Contents/MacOS/webstorm", args: [] },
    ],
    id: "webstorm",
    macosAppNames: ["WebStorm"],
    name: "WebStorm",
  },
  {
    commands: [
      { command: "idea", args: [] },
      { command: "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea", args: [] },
      { command: "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea", args: [] },
      { command: "/Applications/IntelliJ IDEA Community Edition.app/Contents/MacOS/idea", args: [] },
    ],
    id: "idea",
    macosAppNames: ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA Community Edition"],
    name: "IntelliJ IDEA",
  },
]

const macosEditorProcesses: Record<string, string> = {
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code": "code",
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron": "code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders": "code-insiders",
  "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron": "code-insiders",
  "/Applications/VSCodium.app/Contents/MacOS/Electron": "codium",
  "/Applications/Cursor.app/Contents/MacOS/Cursor": "cursor",
  "/Applications/Windsurf.app/Contents/MacOS/Windsurf": "windsurf",
  "/Applications/Windsurf.app/Contents/MacOS/Electron": "windsurf",
  "/Applications/Trae.app/Contents/MacOS/Electron": "trae",
  "/Applications/Qoder.app/Contents/MacOS/Electron": "qoder",
  "/Applications/Antigravity.app/Contents/MacOS/Electron": "antigravity",
  "/Applications/Zed.app/Contents/MacOS/zed": "zed",
  "/Applications/Sublime Text.app/Contents/MacOS/Sublime Text":
    "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
  "/Applications/Sublime Text.app/Contents/MacOS/sublime_text":
    "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
  "/Applications/WebStorm.app/Contents/MacOS/webstorm": "/Applications/WebStorm.app/Contents/MacOS/webstorm",
  "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea": "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
  "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea":
    "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea",
  "/Applications/IntelliJ IDEA Community Edition.app/Contents/MacOS/idea":
    "/Applications/IntelliJ IDEA Community Edition.app/Contents/MacOS/idea",
}

const linuxEditorProcesses: Record<string, string> = {
  code: "code",
  "code-insiders": "code-insiders",
  codium: "codium",
  cursor: "cursor",
  windsurf: "windsurf",
  trae: "trae",
  qoder: "qoder",
  antigravity: "antigravity",
  zed: "zed",
  sublime_text: "subl",
  webstorm: "webstorm",
  "webstorm.sh": "webstorm",
  idea: "idea",
  "idea.sh": "idea",
}

const windowsEditorProcesses = new Map([
  ["Code.exe", "Code.exe"],
  ["Code - Insiders.exe", "Code - Insiders.exe"],
  ["VSCodium.exe", "VSCodium.exe"],
  ["Cursor.exe", "Cursor.exe"],
  ["Windsurf.exe", "Windsurf.exe"],
  ["Trae.exe", "Trae.exe"],
  ["Qoder.exe", "Qoder.exe"],
  ["Antigravity.exe", "Antigravity.exe"],
  ["zed.exe", "zed.exe"],
  ["sublime_text.exe", "sublime_text.exe"],
  ["webstorm64.exe", "webstorm64.exe"],
  ["webstorm.exe", "webstorm.exe"],
  ["idea64.exe", "idea64.exe"],
  ["idea.exe", "idea.exe"],
])

export async function resolveEditorCommand(
  options: ResolveEditorCommandOptions = {},
): Promise<EditorCommand | undefined> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const runExecFile = options.execFile ?? defaultExecFile
  const runAccessPath = options.accessPath ?? access
  const runRealpathPath = options.realpathPath ?? realpath
  const launchEnv = createLaunchEnvironment(env)

  if (options.editorId === "system") {
    return undefined
  }

  if (options.editorId) {
    const candidate = editorCandidates.find((item) => item.id === options.editorId)
    return candidate
      ? resolveEditorCandidateCommand(candidate, platform, launchEnv, runExecFile, runAccessPath, runRealpathPath)
      : undefined
  }

  for (const candidate of editorCandidates) {
    const command = await resolveEditorCandidateCommand(
      candidate,
      platform,
      launchEnv,
      runExecFile,
      runAccessPath,
      runRealpathPath,
    )
    if (command) {
      return command
    }
  }

  // 借鉴 launch-editor：从正在运行的 GUI 编辑器进程反推启动命令，避免 macOS 文件关联把 Markdown 丢给 Xcode。
  return resolveRunningEditorCommand(platform, launchEnv, runExecFile)
}

export async function listSkillEditorApps(options: ResolveEditorCommandOptions = {}): Promise<SkillEditorApp[]> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const runExecFile = options.execFile ?? defaultExecFile
  const runAccessPath = options.accessPath ?? access
  const runRealpathPath = options.realpathPath ?? realpath
  const launchEnv = createLaunchEnvironment(env)
  const apps: SkillEditorApp[] = []

  for (const candidate of editorCandidates) {
    const command = await resolveEditorCandidateCommand(
      candidate,
      platform,
      launchEnv,
      runExecFile,
      runAccessPath,
      runRealpathPath,
    )
    if (command) {
      apps.push({
        available: true,
        id: candidate.id,
        isDefault: false,
        name: candidate.name,
      })
    }
  }

  apps.push({
    available: true,
    id: "system",
    isDefault: false,
    name: "System default",
  })

  return apps.map((app, index) => ({
    ...app,
    isDefault: index === 0,
  }))
}

export async function launchEditorCommand(
  editor: EditorCommand,
  pathname: string,
  options: { env?: NodeJS.ProcessEnv; spawn?: SpawnEditor } = {},
): Promise<void> {
  const runSpawn = options.spawn ?? spawn
  const child = runSpawn(editor.command, [...editor.args, pathname], {
    detached: true,
    env: createLaunchEnvironment(options.env ?? process.env),
    stdio: "ignore",
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, editorSpawnTimeoutMs)
    timer.unref()

    child.on("spawn", () => {
      clearTimeout(timer)
      resolve()
    })
    child.on("error", (cause) => {
      clearTimeout(timer)
      reject(cause)
    })
  })

  child.unref()
}

function createLaunchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: getOoPath(env),
  }
}

async function canRunEditorCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  runExecFile: ExecFileAsync,
): Promise<boolean> {
  try {
    await runExecFile(command, ["--version"], {
      env,
      timeout: editorProbeTimeoutMs,
    })
    return true
  } catch {
    return false
  }
}

async function resolveEditorCandidateCommand(
  candidate: EditorCandidate,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runExecFile: ExecFileAsync,
  runAccessPath: AccessPath,
  runRealpathPath: RealpathPath,
): Promise<EditorCommand | undefined> {
  if (platform === "darwin") {
    const appName = await resolveMacosApplicationName(candidate.macosAppNames ?? [], env, runAccessPath)
    if (appName) {
      return {
        args: ["-a", appName],
        command: "open",
      }
    }
  }

  for (const command of candidate.commands) {
    if (await canUseEditorCommandForCandidate(candidate, command, platform, env, runExecFile, runRealpathPath)) {
      return command
    }
  }

  return undefined
}

async function canUseEditorCommandForCandidate(
  candidate: EditorCandidate,
  command: EditorCommand,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runExecFile: ExecFileAsync,
  runRealpathPath: RealpathPath,
): Promise<boolean> {
  if (!(await canRunEditorCommand(command.command, env, runExecFile))) {
    return false
  }

  if (platform !== "darwin") {
    return true
  }

  const commandPath = await resolveCommandPath(command.command, env, runExecFile)
  if (!commandPath) {
    return true
  }

  const realCommandPath = await runRealpathPath(commandPath).catch(() => commandPath)
  const appName = readMacosApplicationName(realCommandPath)
  if (!appName) {
    return true
  }

  return Boolean(candidate.macosAppNames?.includes(appName))
}

async function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv,
  runExecFile: ExecFileAsync,
): Promise<string | undefined> {
  if (path.isAbsolute(command)) {
    return command
  }

  try {
    const result = await runExecFile("which", [command], {
      env,
      timeout: editorProbeTimeoutMs,
    })
    return result.stdout.toString().split(/\r?\n/)[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

function readMacosApplicationName(pathname: string): string | undefined {
  const match = pathname.match(/\/([^/]+)\.app\//)
  return match?.[1]
}

async function resolveMacosApplicationName(
  appNames: string[],
  env: NodeJS.ProcessEnv,
  runAccessPath: AccessPath,
): Promise<string | undefined> {
  for (const appName of appNames) {
    const applicationPaths = [
      `/Applications/${appName}.app`,
      env.HOME ? path.join(env.HOME, "Applications", `${appName}.app`) : undefined,
    ].filter((pathname): pathname is string => Boolean(pathname))

    for (const applicationPath of applicationPaths) {
      try {
        await runAccessPath(applicationPath)
        return appName
      } catch {
        // 继续探测其它常见位置。
      }
    }
  }

  return undefined
}

async function resolveRunningEditorCommand(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runExecFile: ExecFileAsync,
): Promise<EditorCommand | undefined> {
  try {
    if (platform === "darwin") {
      return resolveMacosRunningEditor(await readProcessList(runExecFile, "ps", ["x", "-o", "comm="], env))
    }

    if (platform === "win32") {
      return resolveWindowsRunningEditor(
        await readProcessList(
          runExecFile,
          "powershell",
          [
            "-NoProfile",
            "-Command",
            '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance -Query "select executablepath from win32_process where executablepath is not null" | % { $_.ExecutablePath }',
          ],
          env,
        ),
      )
    }

    if (platform === "linux") {
      return resolveLinuxRunningEditor(
        await readProcessList(runExecFile, "ps", ["x", "--no-heading", "-o", "comm", "--sort=comm"], env),
      )
    }
  } catch {
    return undefined
  }

  return undefined
}

async function readProcessList(
  runExecFile: ExecFileAsync,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const result = await runExecFile(command, args, {
    env,
    timeout: editorProbeTimeoutMs,
  })

  return result.stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function resolveMacosRunningEditor(processList: string[]): EditorCommand | undefined {
  const processSet = new Set(processList)
  const processOutput = processList.join("\n")

  for (const [processName, command] of Object.entries(macosEditorProcesses)) {
    if (processSet.has(processName)) {
      return createEditorCommand(command)
    }

    const suffix = processName.replace("/Applications", "")
    if (!processOutput.includes(suffix)) {
      continue
    }

    if (processName !== command) {
      return createEditorCommand(command)
    }

    const runningProcess = processList.find((candidate) => candidate.endsWith(suffix))
    if (runningProcess) {
      return createEditorCommand(runningProcess)
    }
  }

  return undefined
}

function resolveLinuxRunningEditor(processList: string[]): EditorCommand | undefined {
  const processSet = new Set(processList.map((processName) => path.basename(processName).toLowerCase()))

  for (const [processName, command] of Object.entries(linuxEditorProcesses)) {
    if (processSet.has(processName.toLowerCase())) {
      return createEditorCommand(command)
    }
  }

  return undefined
}

function resolveWindowsRunningEditor(processList: string[]): EditorCommand | undefined {
  for (const fullProcessPath of processList) {
    const command = windowsEditorProcesses.get(path.basename(fullProcessPath))
    if (command) {
      return createEditorCommand(path.isAbsolute(fullProcessPath) ? fullProcessPath : command)
    }
  }

  return undefined
}

function createEditorCommand(command: string): EditorCommand {
  return {
    args: getEditorArgs(command),
    command,
  }
}

function getEditorArgs(command: string): string[] {
  const editorName = path
    .basename(command)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase()

  switch (editorName) {
    case "code":
    case "code - insiders":
    case "code-insiders":
    case "cursor":
    case "windsurf":
    case "trae":
    case "qoder":
    case "antigravity":
    case "codium":
    case "vscodium":
      return ["--reuse-window"]
    default:
      return []
  }
}

async function defaultExecFile(command: string, args: string[], options: ExecFileOptions): Promise<ExecFileOutput> {
  return execFileAsync(command, args, options)
}
