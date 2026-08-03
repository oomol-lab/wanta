import { downloadWecomCliBinary, exportWecomCliSkills, WECOM_CLI_VERSION } from "./wecom-cli.ts"

try {
  const [binary, skills] = await Promise.all([downloadWecomCliBinary(), exportWecomCliSkills()])
  console.log(`[wanta] WeCom CLI ${WECOM_CLI_VERSION} ready: ${binary}`)
  console.log(`[wanta] WeCom CLI skills ready: ${skills}`)
} catch (error) {
  console.warn("[wanta] download-wecom-cli postinstall failed (non-fatal):", error)
}
