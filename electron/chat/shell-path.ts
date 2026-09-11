/** Resolve a literal shell path without Node APIs or filesystem access. */
export function resolveShellPath(value: string, cwd?: string): string | undefined {
  const isWindows = (path: string) => /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\")
  const windows = isWindows(value) || isWindows(cwd ?? "")
  const slash = (path: string) => (windows ? path.replace(/\\/gu, "/") : path)
  const target = slash(value)
  const base = cwd ? slash(cwd) : undefined
  const root = (path: string) =>
    windows ? /^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+(?:\/|$))/u.exec(path)?.[0] : path.startsWith("/") ? "/" : undefined
  // Drive-relative paths require per-drive process state that is not available here.
  if (windows && /^[A-Za-z]:(?!\/)/u.test(target)) return undefined
  if (windows && target.startsWith("/") && !root(target)) return undefined
  const combined = root(target) ? target : base && root(base) ? `${base}/${target}` : undefined
  if (!combined) return undefined
  const prefix = root(combined)!
  const parts: string[] = []
  for (const part of combined.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  const resolved = prefix.replace(/\/?$/u, "/") + parts.join("/")
  return windows ? resolved.replace(/\//gu, "\\") : resolved
}
