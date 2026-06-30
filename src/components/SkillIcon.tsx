import type { AppIconComponent } from "@/components/AppIcons"
import type { IconifyIcon as IconifyIconData } from "@iconify/types"

import cloudflareIcon from "@iconify-icons/simple-icons/cloudflare"
import googleBigQueryIcon from "@iconify-icons/simple-icons/googlebigquery"
import openAiIcon from "@iconify-icons/simple-icons/openai"
import tencentQqIcon from "@iconify-icons/simple-icons/tencentqq"
import wechatIcon from "@iconify-icons/simple-icons/wechat"
import flameIcon from "@iconify-icons/tabler/flame"
import photoStarIcon from "@iconify-icons/tabler/photo-star"
import {
  ArchiveIcon,
  BoxIcon,
  CaptionsIcon,
  ChartNoAxesCombinedIcon,
  FileSearchIcon,
  FileScanIcon,
  FolderDownIcon,
  ImageOffIcon,
  ImagePlusIcon,
  LayoutTemplateIcon,
  SearchCheckIcon,
  SendIcon,
  ShirtIcon,
  ShoppingBagIcon,
  UploadCloudIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react"
import { AppIcons } from "@/components/AppIcons"
import { createIconifySvgIcon } from "@/components/IconifySvg"
import { normalizeSkillIconSource } from "@/components/skill-icon-source.ts"
import { cn } from "@/lib/utils"

const lucideSkillIcons = {
  archive: ArchiveIcon,
  box: BoxIcon,
  captions: CaptionsIcon,
  "chart-no-axes-combined": ChartNoAxesCombinedIcon,
  "file-search": FileSearchIcon,
  "file-scan": FileScanIcon,
  "folder-down": FolderDownIcon,
  "image-off": ImageOffIcon,
  "image-plus": ImagePlusIcon,
  "layout-template": LayoutTemplateIcon,
  search: AppIcons.utility.search,
  "search-check": SearchCheckIcon,
  send: SendIcon,
  shirt: ShirtIcon,
  sparkles: AppIcons.utility.sparkles,
  "shopping-bag": ShoppingBagIcon,
  "upload-cloud": UploadCloudIcon,
  "wand-sparkles": WandSparklesIcon,
  wrench: WrenchIcon,
} satisfies Record<string, AppIconComponent>

type LucideSkillIconName = keyof typeof lucideSkillIcons

const iconifySkillIcons = {
  "simple-icons:cloudflare": cloudflareIcon,
  "simple-icons:googlebigquery": googleBigQueryIcon,
  "simple-icons:openai": openAiIcon,
  "simple-icons:tencentqq": tencentQqIcon,
  "simple-icons:wechat": wechatIcon,
  "tabler:flame": flameIcon,
  "tabler:photo-spark": photoStarIcon,
  "tabler:photo-star": photoStarIcon,
} satisfies Record<string, IconifyIconData>

type IconifySkillIconName = keyof typeof iconifySkillIcons

const iconifySkillIconComponents = Object.fromEntries(
  Object.entries(iconifySkillIcons).map(([key, icon]) => [key, createIconifySvgIcon(icon)]),
) as Record<IconifySkillIconName, AppIconComponent>

interface SkillIconProps {
  className?: string
  fallback?: AppIconComponent
  icon?: string
}

export function SkillIcon({ className, fallback: FallbackIcon = AppIcons.object.skill, icon }: SkillIconProps) {
  const Icon = getSkillIcon(icon) ?? FallbackIcon

  return <Icon className={cn("oo-icon-muted size-4 shrink-0", className)} />
}

function getSkillIcon(icon: string | undefined): AppIconComponent | undefined {
  const spec = parseIconEsSpec(normalizeSkillIconSource(icon))

  if (!spec) {
    return undefined
  }

  if (spec.collection === "lucide" && spec.name in lucideSkillIcons) {
    return lucideSkillIcons[spec.name as LucideSkillIconName]
  }

  const iconifyIconName = `${spec.collection}:${spec.name}`

  if (iconifyIconName in iconifySkillIcons) {
    return iconifySkillIconComponents[iconifyIconName as IconifySkillIconName]
  }

  return undefined
}

function parseIconEsSpec(icon: string | undefined): { collection: string; name: string } | null {
  const value = icon?.trim()

  if (!value) {
    return null
  }

  const iconEsMatch = /^:([^:]+):([^:]+):?$/.exec(value)

  if (iconEsMatch) {
    return {
      collection: iconEsMatch[1],
      name: iconEsMatch[2],
    }
  }

  const prefixedMatch = /^([^:]+):([^:]+)$/.exec(value)

  if (prefixedMatch) {
    return {
      collection: prefixedMatch[1],
      name: prefixedMatch[2],
    }
  }

  return {
    collection: "lucide",
    name: value,
  }
}
