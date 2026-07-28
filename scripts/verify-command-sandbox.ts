import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { CommandSandboxPolicyStore } from "../electron/agent/command-sandbox/policy.ts"

const root = await mkdtemp(path.join(os.tmpdir(), "wanta-command-sandbox-probe-"))
const sessionId = "probe-session"
const authKey = "probe-auth-key"
const project = path.join(root, "project")
const attachment = path.join(project, "attachment.txt")
const outside = path.join(root, "outside.txt")
const outsideReadMarker = path.join(project, "outside-was-readable.txt")
const detachedMarker = path.join(root, "detached.txt")
const policyRoot = path.join(root, "sandbox")
const wrapper = path.resolve("dist-electron/wanta-command-shell.js")
await mkdir(project)
await Promise.all([writeFile(attachment, "attachment"), writeFile(outside, "outside-secret")])

const server = createServer((_request, response) => {
  response.end("loopback-ok")
})
await new Promise<void>((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => resolve())
})
const address = server.address()
if (!address || typeof address === "string") throw new Error("Probe server has no port.")

try {
  const store = new CommandSandboxPolicyStore({ authKey, rootDir: policyRoot })
  await store.write({
    executionMode: "sandbox",
    sessionId,
    readOnlyPaths: [attachment],
    readWritePaths: [project],
    runtimeReadPaths: [path.resolve("."), path.dirname(process.execPath)],
  })
  const command = [
    `test "$(cat ${quote(attachment)})" = attachment`,
    `! printf changed > ${quote(attachment)} 2>/dev/null`,
    `printf project-ok > ${quote(path.join(project, "created.txt"))}`,
    `if cat ${quote(outside)} >/dev/null 2>&1; then touch ${quote(outsideReadMarker)}; fi`,
    `! printf denied > ${quote(outside)} 2>/dev/null`,
    `test -z "$OO_API_KEY"`,
    `test "$(curl -fsS http://127.0.0.1:${address.port})" = loopback-ok`,
    `printf 'GET / HTTP/1.0\\r\\n\\r\\n' | nc -w 2 127.0.0.1 ${address.port} | grep -q loopback-ok`,
    `nohup sh -c ${quote(`sleep 1; touch ${quote(detachedMarker)}`)} >/dev/null 2>&1 &`,
  ].join("\n")
  const result = await run(process.execPath, [wrapper, "-c", command], {
    ...process.env,
    OO_API_KEY: "must-not-leak",
    PATH: process.env.PATH,
    WANTA_COMMAND_SANDBOX_AUTH: authKey,
    WANTA_COMMAND_SANDBOX_BROKER_URL: "http://127.0.0.1:9",
    WANTA_COMMAND_SANDBOX_CALL_ID: "probe-call",
    WANTA_COMMAND_SANDBOX_DELEGATE_SHELL: "/bin/zsh",
    WANTA_COMMAND_SANDBOX_POLICY_DIR: store.policyDir,
    WANTA_COMMAND_SANDBOX_SESSION_ID: sessionId,
  })
  await new Promise((resolve) => setTimeout(resolve, 1_400))
  const assertions = {
    attachmentRead: result.code === 0,
    attachmentWriteBlocked: (await readFile(attachment, "utf8")) === "attachment",
    controlDirProtected: await probeNestedControlDirectory(store, root),
    detachedReaped: !(await exists(detachedMarker)),
    outsideReadBlocked: !(await exists(outsideReadMarker)),
    outsideWriteBlocked: (await readFile(outside, "utf8")) === "outside-secret",
    projectWrite: (await readFile(path.join(project, "created.txt"), "utf8")) === "project-ok",
  }
  const integration = await probeOpenCodeIntegration(root, project, wrapper)
  const direct = await probeDirectExecution(store, outside, wrapper)
  process.stdout.write(
    `${JSON.stringify({ assertions, direct, integration, stderr: result.stderr.trim() }, null, 2)}\n`,
  )
  if (Object.values(assertions).some((value) => !value)) process.exitCode = 1
  if (Object.values(direct).some((value) => !value)) process.exitCode = 1
  if (!integration.shellPolicyHandoff) process.exitCode = 1
} finally {
  server.close()
  await rm(root, { force: true, recursive: true })
}

async function probeNestedControlDirectory(store: CommandSandboxPolicyStore, allowedRoot: string): Promise<boolean> {
  try {
    await store.write({
      executionMode: "sandbox",
      sessionId,
      readWritePaths: [allowedRoot],
      runtimeReadPaths: [path.resolve("."), path.dirname(process.execPath)],
    })
  } catch {
    return true
  }
  const result = await run(process.execPath, [wrapper, "-c", `! cat ${quote(store.pathForSession(sessionId))}`], {
    ...process.env,
    PATH: process.env.PATH,
    WANTA_COMMAND_SANDBOX_AUTH: authKey,
    WANTA_COMMAND_SANDBOX_BROKER_URL: "http://127.0.0.1:9",
    WANTA_COMMAND_SANDBOX_CALL_ID: "probe-control-dir",
    WANTA_COMMAND_SANDBOX_DELEGATE_SHELL: "/bin/zsh",
    WANTA_COMMAND_SANDBOX_POLICY_DIR: store.policyDir,
    WANTA_COMMAND_SANDBOX_SESSION_ID: sessionId,
  })
  return result.code === 0
}

async function probeDirectExecution(
  store: CommandSandboxPolicyStore,
  outside: string,
  commandSandboxCliPath: string,
): Promise<{ internalCredentialsHidden: boolean; outsideWriteAllowed: boolean; realHomeAvailable: boolean }> {
  const directHomeMarker = path.join(path.dirname(outside), "direct-home.txt")
  const leakedCredentialMarker = path.join(path.dirname(outside), "direct-credential-leaked.txt")
  await store.write({
    executionMode: "direct",
    sessionId,
  })
  const result = await run(
    process.execPath,
    [
      commandSandboxCliPath,
      "-c",
      [
        `printf '%s' "$HOME" > ${quote(directHomeMarker)}`,
        `if test -n "$OO_API_KEY"; then touch ${quote(leakedCredentialMarker)}; fi`,
        `printf direct-ok > ${quote(outside)}`,
      ].join("\n"),
    ],
    {
      ...process.env,
      OO_API_KEY: "must-not-leak",
      PATH: process.env.PATH,
      WANTA_COMMAND_SANDBOX_AUTH: authKey,
      WANTA_COMMAND_SANDBOX_BROKER_URL: "http://127.0.0.1:9",
      WANTA_COMMAND_SANDBOX_CALL_ID: "probe-direct",
      WANTA_COMMAND_SANDBOX_DELEGATE_SHELL: "/bin/zsh",
      WANTA_COMMAND_SANDBOX_POLICY_DIR: store.policyDir,
      WANTA_COMMAND_SANDBOX_SESSION_ID: sessionId,
    },
  )
  return {
    internalCredentialsHidden: !(await exists(leakedCredentialMarker)),
    outsideWriteAllowed: result.code === 0 && (await readFile(outside, "utf8")) === "direct-ok",
    realHomeAvailable: (await readFile(directHomeMarker, "utf8")) === os.homedir(),
  }
}

async function probeOpenCodeIntegration(
  rootDir: string,
  projectDir: string,
  commandSandboxCliPath: string,
): Promise<{ shellPolicyHandoff: boolean }> {
  Object.assign(globalThis, {
    __APP_COMMIT__: "probe",
    __APP_VERSION__: "0.0.0",
    __OO_ENDPOINT__: "oomol.com",
    __PACKAGE_ASSETS_BASE_URL__: "https://package-assets.oomol.com",
  })
  const [{ resolveDevOpencodeBin }, { AgentManager }] = await Promise.all([
    import("../electron/agent/binaries.ts"),
    import("../electron/agent/manager.ts"),
  ])
  const manager = new AgentManager({
    bundledToolRuntimePath: path.resolve("resources/agent-tool-runtime/tool.js"),
    commandSandboxCliPath,
    customModels: [
      {
        apiKey: "unused",
        apiKeyConfigured: true,
        baseUrl: "http://127.0.0.1:9/v1",
        id: "probe-model",
        modelName: "probe-model",
        providerId: "probe",
        providerName: "Probe",
      },
    ],
    defaultModel: { kind: "custom", id: "probe-model" },
    linkRuntime: null,
    modelAccess: { kind: "local" },
    opencodeBinPath: resolveDevOpencodeBin(path.resolve(".")),
    rootDir: path.join(rootDir, "agent"),
  })
  const marker = path.join(projectDir, "opencode-shell.txt")
  try {
    await manager.start()
    const session = await manager.createSession("Sandbox probe")
    await manager.updateCommandSandboxPolicy({
      executionMode: "sandbox",
      sessionId: session.id,
      readWritePaths: [projectDir],
    })
    const result = await manager.client.session.shell({
      agent: "build",
      command: `printf opencode-ok > ${quote(marker)}`,
      model: { modelID: "probe-model", providerID: "wanta-custom-probe-model" },
      sessionID: session.id,
    })
    if (result.error) throw new Error(`OpenCode shell probe failed: ${JSON.stringify(result.error)}`)
    return { shellPolicyHandoff: (await readFile(marker, "utf8")) === "opencode-ok" }
  } finally {
    await manager.dispose()
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function exists(filePath: string): Promise<boolean> {
  return readFile(filePath).then(
    () => true,
    () => false,
  )
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    let stdout = ""
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.once("error", reject)
    child.once("exit", (code) => resolve({ code, stderr, stdout }))
  })
}
