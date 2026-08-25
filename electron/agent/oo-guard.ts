interface GuardResponse {
  error?: string
  exitCode?: number
  stderr?: string
  stdout?: string
}

export {}

async function main(): Promise<void> {
  const url = process.env.WANTA_OO_GUARD_URL?.trim()
  const token = process.env.WANTA_OO_GUARD_TOKEN?.trim()
  if (!url || !token) throw new Error("Wanta's managed OO execution boundary is unavailable.")
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: process.argv.slice(2) }),
  })
  const body = (await response.json()) as GuardResponse
  if (!response.ok) throw new Error(body.error || `Managed OO request failed with status ${response.status}.`)
  if (body.stdout) process.stdout.write(body.stdout)
  if (body.stderr) process.stderr.write(body.stderr)
  process.exitCode = body.exitCode ?? 1
}

await main().catch((error: unknown) => {
  process.stderr.write(`Wanta oo guard: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
