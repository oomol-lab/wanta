import { runCommandSandboxShell } from "./command-sandbox/runtime.ts"

runCommandSandboxShell(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`wanta-command-shell: ${message}\n`)
    process.exitCode = 1
  })
