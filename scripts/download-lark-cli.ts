import { downloadLarkCliBinary, exportLarkCliSkills, LARK_CLI_VERSION } from "./lark-cli.ts"

try {
  if (process.env.LARK_CLI_SKIP_BINARY_DOWNLOAD === "1") {
    console.log("LARK_CLI_SKIP_BINARY_DOWNLOAD=1, skip downloading Lark CLI.")
  } else {
    const binary = await downloadLarkCliBinary()
    const skills = await exportLarkCliSkills()
    console.log(`[wanta] Lark CLI ${LARK_CLI_VERSION} ready at ${binary}`)
    console.log(`[wanta] Lark CLI skills ready at ${skills}`)
  }
} catch (error) {
  console.warn("[wanta] download-lark-cli postinstall failed (non-fatal):", error)
}
