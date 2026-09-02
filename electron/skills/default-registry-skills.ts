export interface DefaultRegistrySkillSpec {
  category?: "ecommerce" | "image-generation" | "document" | "productivity" | "other"
  enabled: boolean
  minimumVersion?: string
  packageName: string
  skillId: string
}

export const defaultRegistrySkillSetVersion = 5

// 默认安装清单：登录后后台补装，必须使用 registry 中稳定的 packageName + skillId。
export const defaultRegistrySkills: readonly DefaultRegistrySkillSpec[] = [
  {
    category: "other",
    enabled: true,
    minimumVersion: "1.0.0",
    packageName: "oo-oomol-console",
    skillId: "oo-oomol-console",
  },
  {
    category: "image-generation",
    enabled: true,
    minimumVersion: "1.1.2",
    packageName: "@zjxuyunshi/gpt-image-2",
    skillId: "gpt-image-2",
  },
  {
    category: "ecommerce",
    enabled: true,
    packageName: "@zjxuyunshi/ecommerce-image-studio",
    skillId: "ecommerce-image-studio",
  },
  {
    category: "other",
    enabled: true,
    packageName: "@alwaysmavs/public-social-research",
    skillId: "public-social-research",
  },
]
