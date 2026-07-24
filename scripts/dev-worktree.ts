import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

interface BootstrapConfig {
  env?: Record<string, string>
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const bootstrapJsonPath = path.join(repoRoot, ".wanta-dev", "bootstrap.json")

await main()

async function main(): Promise<void> {
  const config = await readBootstrapConfig()
  await run(commandName("corepack"), ["npm", "run", "dev"], config.env ?? {})
}

async function readBootstrapConfig(): Promise<BootstrapConfig> {
  try {
    return JSON.parse(await readFile(bootstrapJsonPath, "utf-8")) as BootstrapConfig
  } catch (error) {
    throw new Error(`bootstrap config missing or invalid; run \`corepack npm run bootstrap\` first: ${error}`)
  }
}

async function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`))
    })
  })
}

function commandName(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command
}
