import type { HostCapabilityContext } from "./host-capability.ts"

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink } from "node:fs/promises"
import path from "node:path"
import { ZipFile } from "yazl"
import { redactConnectorOutput } from "./oo-guard-core.ts"

export interface SpacesProject {
  root: string
  fingerprint: string
  files: string[]
}
const excluded = new Set([
  "node_modules",
  ".git",
  ".wanta",
  "dist",
  ".next",
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".netrc",
])
const maxSourceBytes = 50 * 1024 * 1024

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

export async function inspectSpacesProject(context: HostCapabilityContext, input: string): Promise<SpacesProject> {
  const candidate = path.resolve(context.projectRoot ?? context.artifactDir ?? "", input)
  const roots = [context.projectRoot, context.artifactDir].filter((root): root is string => Boolean(root))
  const allowed = roots.find((root) => inside(path.resolve(root), candidate))
  if (!allowed) throw new Error("Spaces project must be inside this task's project or artifact directory.")
  const root = await realpath(candidate)
  if (!inside(await realpath(allowed), root)) throw new Error("Spaces project escapes its managed root.")
  // Reject symlink path components rather than trusting only the final realpath.
  let current = path.resolve(allowed)
  for (const segment of ["", ...path.relative(current, candidate).split(path.sep)].filter(
    (part, index) => part || index === 0,
  )) {
    current = path.join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Spaces project path contains a symbolic link.")
  }
  const files: string[] = []
  let bytes = 0
  const digest = createHash("sha256")
  async function walk(relative: string): Promise<void> {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      if (excluded.has(name) || name.startsWith(".env") || name === "_generated") continue
      const file = path.join(relative, name)
      const info = await lstat(path.join(root, file))
      if (info.isSymbolicLink()) throw new Error("Spaces source must not contain symbolic links.")
      if (info.isDirectory()) {
        await walk(file)
        continue
      }
      if (!info.isFile()) throw new Error("Spaces source contains a non-regular file.")
      bytes += info.size
      if (bytes > maxSourceBytes || files.length >= 5000)
        throw new Error("Spaces project exceeds the source size or file limit.")
      files.push(file)
      digest
        .update(file)
        .update("\0")
        .update(await readFile(path.join(root, file)))
        .update("\0")
    }
  }
  await walk("")
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts?: { build?: unknown }
    dependencies?: Record<string, unknown>
  }
  if (typeof pkg.scripts?.build !== "string" || !pkg.scripts.build.trim())
    throw new Error("Spaces requires a package.json build script producing dist/index.html.")
  if (!pkg.dependencies?.convex || !files.some((file) => file.startsWith(`convex${path.sep}`))) {
    throw new Error(
      "This project has no Convex backend. Use the static website workflow instead of creating a paid Space.",
    )
  }
  return { root, fingerprint: digest.digest("hex"), files }
}

/** Start project code with a small environment allowlist, never the Wanta process environment. */
export function spacesBuildEnvironment(home: string, shim: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    PATH: [shim, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
    BUN_BE_BUN: "1",
    CI: "1",
    LANG: "en_US.UTF-8",
    ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  }
}

export interface PreparedSpacesBuild {
  cwd: string
  env: NodeJS.ProcessEnv
}
export async function prepareSpacesBuild(
  project: SpacesProject,
  processDir: string,
  binary: string,
): Promise<PreparedSpacesBuild> {
  await mkdir(processDir, { recursive: true })
  const work = await mkdtemp(path.join(processDir, "spaces-build-"))
  const cwd = path.join(work, "project")
  const home = path.join(work, "home")
  const shim = path.join(work, "bin")
  await Promise.all([mkdir(cwd), mkdir(home), mkdir(shim)])
  const snapshotDigest = createHash("sha256")
  for (const file of project.files) {
    const target = path.join(cwd, file)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.join(project.root, file), target, { dereference: false, errorOnExist: true })
    if (!(await lstat(target)).isFile()) throw new Error("Spaces source changed during snapshot creation.")
    snapshotDigest
      .update(file)
      .update("\0")
      .update(await readFile(target))
      .update("\0")
  }
  if (snapshotDigest.digest("hex") !== project.fingerprint)
    throw new Error("Spaces source changed while copying the confirmed project.")
  await Promise.all([symlink(binary, path.join(shim, "bun")), symlink(binary, path.join(shim, "node"))])
  return { cwd, env: spacesBuildEnvironment(home, shim) }
}

export async function runSpacesBuild(
  binary: string,
  args: string[],
  build: PreparedSpacesBuild,
  options: { signal: AbortSignal; secrets?: string[]; extraEnv?: Record<string, string> },
): Promise<void> {
  options.signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: build.cwd,
      env: { ...build.env, ...options.extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })
    let output = ""
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-32_000)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        /* The process group already exited. */
      }
    }
    const abort = () => {
      kill("SIGTERM")
      killTimer ??= setTimeout(() => kill("SIGKILL"), 2_000)
      killTimer.unref()
    }
    options.signal.addEventListener("abort", abort, { once: true })
    child.on("error", () => {
      clearTimeout(killTimer)
      options.signal.removeEventListener("abort", abort)
      reject(new Error("Spaces build process could not start."))
    })
    child.on("close", (code) => {
      clearTimeout(killTimer)
      options.signal.removeEventListener("abort", abort)
      if (options.signal.aborted) {
        reject(new Error("Spaces deployment cancelled; the backend may already have changed."))
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      for (const secret of options.secrets ?? []) if (secret) output = output.replaceAll(secret, "[redacted]")
      reject(new Error(`Spaces build step failed (exit ${code}). ${redactConnectorOutput(output)}`))
    })
    if (options.signal.aborted) abort()
  })
}

export async function packSpacesBuild(root: string): Promise<Buffer> {
  const dist = path.join(root, "dist")
  if (!(await lstat(dist)).isDirectory() || (await lstat(dist)).isSymbolicLink())
    throw new Error("Spaces build must produce a regular dist directory.")
  if (!(await lstat(path.join(dist, "index.html"))).isFile())
    throw new Error("Spaces build must produce dist/index.html.")
  const zip = new ZipFile()
  let files = 0
  let bytes = 0
  async function walk(relative: string): Promise<void> {
    for (const name of (await readdir(path.join(dist, relative))).sort()) {
      if (name.startsWith(".env")) throw new Error("Deployment output contains an environment file.")
      const file = path.join(relative, name)
      const info = await lstat(path.join(dist, file))
      if (info.isSymbolicLink()) throw new Error("Deployment output contains a symbolic link.")
      if (info.isDirectory()) {
        await walk(file)
        continue
      }
      if (!info.isFile() || ++files > 5000 || (bytes += info.size) > 200 * 1024 * 1024 || info.size > 50 * 1024 * 1024)
        throw new Error("Deployment output exceeds Spaces artifact limits.")
      zip.addBuffer(await readFile(path.join(dist, file)), file.split(path.sep).join("/"))
    }
  }
  await walk("")
  const chunks: Buffer[] = []
  const completed = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on("error", reject)
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
  })
  zip.end()
  const bytesOut = await completed
  if (bytesOut.length > 50 * 1024 * 1024) throw new Error("Spaces artifact exceeds 50 MB.")
  return bytesOut
}
