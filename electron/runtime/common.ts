export type RuntimeMode = "local" | "oomol"

/** 可跨 preload / Renderer 边界共享的无凭证能力摘要。 */
export interface RuntimeCapabilities {
  mode: RuntimeMode
  localAgent: boolean
  localTools: boolean
  customModels: boolean
  oomolCloudModels: boolean
  connectors: boolean
  teams: boolean
  billing: boolean
  cloudSkills: boolean
  voice: boolean
}

export interface RuntimeCapabilityOptions {
  mode: RuntimeMode
  /** 当前构建与运行状态是否已经具备本地 Agent；免登录 runtime 落地前保持 false。 */
  localAgentAvailable: boolean
  linkRuntimeAvailable: boolean
}

/**
 * 从无凭证运行模式推导产品能力。身份 token 只能留在主进程的 AuthManager，
 * 不得为了计算或传输能力摘要而加入本结构。
 */
export function resolveRuntimeCapabilities({
  mode,
  localAgentAvailable,
  linkRuntimeAvailable,
}: RuntimeCapabilityOptions): RuntimeCapabilities {
  const oomol = mode === "oomol"
  return {
    mode,
    localAgent: localAgentAvailable,
    localTools: localAgentAvailable,
    customModels: true,
    oomolCloudModels: oomol,
    connectors: localAgentAvailable && linkRuntimeAvailable,
    teams: oomol,
    billing: oomol,
    cloudSkills: oomol,
    voice: oomol,
  }
}
