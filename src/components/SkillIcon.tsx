import type { AppIconComponent } from "@/components/AppIcons"
import type { IconifyIcon as IconifyIconData } from "@iconify/types"
import type { SVGProps } from "react"

import cloudflareIcon from "@iconify-icons/simple-icons/cloudflare"
import googleBigQueryIcon from "@iconify-icons/simple-icons/googlebigquery"
import openAiIcon from "@iconify-icons/simple-icons/openai"
import tencentQqIcon from "@iconify-icons/simple-icons/tencentqq"
import photoStarIcon from "@iconify-icons/tabler/photo-star"
import {
  ArchiveIcon,
  CaptionsIcon,
  ChartNoAxesCombinedIcon,
  FileSearchIcon,
  FileScanIcon,
  ImageOffIcon,
  ImagePlusIcon,
  UploadCloudIcon,
  WandSparklesIcon,
} from "lucide-react"
import { AppIcons } from "@/components/AppIcons"
import { normalizeSkillIconSource } from "@/components/skill-icon-source.ts"
import { cn } from "@/lib/utils"

const lucideSkillIcons = {
  archive: ArchiveIcon,
  captions: CaptionsIcon,
  "chart-no-axes-combined": ChartNoAxesCombinedIcon,
  "file-search": FileSearchIcon,
  "file-scan": FileScanIcon,
  "image-off": ImageOffIcon,
  "image-plus": ImagePlusIcon,
  search: AppIcons.utility.search,
  sparkles: AppIcons.utility.sparkles,
  "upload-cloud": UploadCloudIcon,
  "wand-sparkles": WandSparklesIcon,
} satisfies Record<string, AppIconComponent>

type LucideSkillIconName = keyof typeof lucideSkillIcons

const iconifySkillIcons = {
  "simple-icons:cloudflare": cloudflareIcon,
  "simple-icons:googlebigquery": googleBigQueryIcon,
  "simple-icons:openai": openAiIcon,
  "simple-icons:tencentqq": tencentQqIcon,
  "tabler:photo-spark": photoStarIcon,
  "tabler:photo-star": photoStarIcon,
} satisfies Record<string, IconifyIconData>

type IconifySkillIconName = keyof typeof iconifySkillIcons

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
    return createIconifySkillIcon(iconifySkillIcons[iconifyIconName as IconifySkillIconName])
  }

  return undefined
}

function createIconifySkillIcon(icon: IconifyIconData): AppIconComponent {
  return function IconifySkillIcon({ children: _children, ...props }: SVGProps<SVGSVGElement>) {
    const width = icon.width ?? 16
    const height = icon.height ?? width
    return (
      <svg
        {...props}
        width="1em"
        height="1em"
        viewBox={`0 0 ${width} ${height}`}
        dangerouslySetInnerHTML={{ __html: icon.body }}
      />
    )
  }
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
