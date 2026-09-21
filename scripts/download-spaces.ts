import { downloadSpacesBinary } from "./spaces-cli.ts"

try {
  const binary = await downloadSpacesBinary()
  console.log(binary ? "[wanta] Spaces runtime ready" : "[wanta] Spaces runtime unavailable on this platform")
} catch (error) {
  console.warn("[wanta] Spaces runtime download failed:", error)
  process.exitCode = 1
}
