const blockedDingTalkEnvironmentNames = new Set([
  "DINGTALK_DWS_AGENTCODE",
  "DWS_CHANNEL",
  "DWS_CLIENT_ID",
  "DWS_CLIENT_SECRET",
  "DWS_DISABLE_KEYCHAIN",
  "DWS_GITEE_REPO",
])

const managedDingTalkEnvironmentNames = new Set(["DWS_CONFIG_DIR", "DWS_KEYCHAIN_DIR"])

export function sanitizeDingTalkEnvironment(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  for (const name of Object.keys(environment)) {
    const normalized = platform === "win32" ? name.toUpperCase() : name
    if (blockedDingTalkEnvironmentNames.has(normalized)) {
      delete environment[name]
      continue
    }
    if (platform === "win32" && managedDingTalkEnvironmentNames.has(normalized) && name !== normalized) {
      delete environment[name]
    }
  }
  return environment
}
