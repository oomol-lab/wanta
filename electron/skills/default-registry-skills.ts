export interface DefaultRegistrySkillSpec {
  category?: "ecommerce" | "image-generation" | "document" | "productivity" | "other"
  enabled: boolean
  packageName: string
  skillId: string
}

export const defaultRegistrySkillSetVersion = 3

// 默认安装清单：登录后后台补装，必须使用 registry 中稳定的 packageName + skillId。
export const defaultRegistrySkills: readonly DefaultRegistrySkillSpec[] = [
  {
    category: "image-generation",
    enabled: true,
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
