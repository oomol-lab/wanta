import {
  DINGTALK_CLI_VERSION,
  downloadDingTalkCliBinary,
  exportDingTalkCliSkills,
} from "./dingtalk-cli.ts"

try {
  const [binary, skills] = await Promise.all([downloadDingTalkCliBinary(), exportDingTalkCliSkills()])
  console.log(`[wanta] DingTalk CLI ${DINGTALK_CLI_VERSION} ready: ${binary}`)
  console.log(`[wanta] DingTalk CLI skills ready: ${skills}`)
} catch (error) {
  console.warn("[wanta] download-dingtalk-cli postinstall failed (non-fatal):", error)
}
