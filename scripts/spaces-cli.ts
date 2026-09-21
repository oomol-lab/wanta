import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { fetchWithRetry } from "./network-download.ts"
import { detectLinuxLibc, extractFileFromTar } from "./oo-cli.ts"

// Immutable upstream release metadata; never follow a mutable latest pointer at install time.
export const SPACES_VERSION = "0.4.0"
const release = "0.4.0-34811934892-1"
const checksums: Record<string, string> = {
  "darwin-arm64": "411764ddc04fe0ef3e20fb21b63e5d05e7a40fb1fe642dae4a5dfb80bb2e50e0",
  "darwin-x64": "d694a55d09a1155674eaa1bc71afa371672f3954be0660c376e9b5d53d362ea5",
  "linux-arm64-gnu": "b40354df24c3d3c2c7d9274f55557686b25d38f317d4e998b1d64cd124a205b1",
  "linux-arm64-musl": "4ac6ff7ee41e211a9541e026726642aa115283a23e392929b404ba00397eb603",
  "linux-x64-gnu": "cd670888bf64c83c87b69c844ee466e266c3df13f23c2cd07c723f799049de53",
  "linux-x64-musl": "5b9c52ea631414a238ae0e1b3a9cbb78ff3fb6a53b41117812054724cf092a76",
}

export function spacesTarget(platform = process.platform, arch: string = process.arch): string | null {
  const target = `${platform}-${arch}${platform === "linux" ? `-${detectLinuxLibc() === "glibc" ? "gnu" : "musl"}` : ""}`
  return checksums[target] ? target : null
}

export async function downloadSpacesBinary(
  outDir = fileURLToPath(new URL("../.spaces-bin/", import.meta.url)),
): Promise<string | null> {
  const target = spacesTarget()
  if (!target) return null // Upstream has no Windows release. Other Wanta capabilities remain available.
  await mkdir(outDir, { recursive: true })
  const binary = path.join(outDir, "spaces")
  const marker = path.join(outDir, "integrity.json")
  try {
    const saved = JSON.parse(await readFile(marker, "utf8")) as { version: string; target: string; sha256: string }
    if (
      saved.version === SPACES_VERSION &&
      saved.target === target &&
      digest(await readFile(binary)) === saved.sha256
    ) {
      return binary
    }
  } catch {
    /* Download and verify a missing or damaged installation. */
  }
  const response = await fetchWithRetry(
    `https://static.oomol.com/release/apps/spaces/${release}/spaces-${SPACES_VERSION}-${target}.tar.gz`,
    {},
    { timeoutMs: 120_000 },
  )
  if (!response.ok) throw new Error(`Spaces download failed: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  if (digest(archive) !== checksums[target]) throw new Error("Spaces archive checksum mismatch.")
  const tar = gunzipSync(archive)
  const content = extractFileFromTar(tar, "spaces") ?? extractFileFromTar(tar, "bin/spaces")
  if (!content) throw new Error("Spaces archive has no executable.")
  const temporary = `${binary}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o755 })
    await chmod(temporary, 0o755)
    await rename(temporary, binary)
    await writeFile(marker, JSON.stringify({ version: SPACES_VERSION, target, sha256: digest(content) }))
  } finally {
    await rm(temporary, { force: true })
  }
  return binary
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}
