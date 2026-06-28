import type { LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { FileIconKey } from "./file-type-descriptor.ts"
import type { FileVisualSource } from "./file-type-kind.ts"
import type { AppIconComponent } from "@/components/AppIcons"
import type { IconifyIcon as IconifyIconData } from "@iconify/types"

import fileTypeBmpIcon from "@iconify-icons/tabler/file-type-bmp"
import fileTypeCssIcon from "@iconify-icons/tabler/file-type-css"
import fileTypeCsvIcon from "@iconify-icons/tabler/file-type-csv"
import fileTypeDocIcon from "@iconify-icons/tabler/file-type-doc"
import fileTypeDocxIcon from "@iconify-icons/tabler/file-type-docx"
import fileTypeHtmlIcon from "@iconify-icons/tabler/file-type-html"
import fileTypeJpgIcon from "@iconify-icons/tabler/file-type-jpg"
import fileTypeJsIcon from "@iconify-icons/tabler/file-type-js"
import fileTypeJsxIcon from "@iconify-icons/tabler/file-type-jsx"
import fileTypePdfIcon from "@iconify-icons/tabler/file-type-pdf"
import fileTypePhpIcon from "@iconify-icons/tabler/file-type-php"
import fileTypePngIcon from "@iconify-icons/tabler/file-type-png"
import fileTypePptIcon from "@iconify-icons/tabler/file-type-ppt"
import fileTypeRsIcon from "@iconify-icons/tabler/file-type-rs"
import fileTypeSqlIcon from "@iconify-icons/tabler/file-type-sql"
import fileTypeSvgIcon from "@iconify-icons/tabler/file-type-svg"
import fileTypeTsIcon from "@iconify-icons/tabler/file-type-ts"
import fileTypeTsxIcon from "@iconify-icons/tabler/file-type-tsx"
import fileTypeTxtIcon from "@iconify-icons/tabler/file-type-txt"
import fileTypeVueIcon from "@iconify-icons/tabler/file-type-vue"
import fileTypeXlsIcon from "@iconify-icons/tabler/file-type-xls"
import fileTypeXmlIcon from "@iconify-icons/tabler/file-type-xml"
import fileTypeZipIcon from "@iconify-icons/tabler/file-type-zip"
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  Globe,
} from "lucide-react"
import { fileTypeDescriptor } from "./file-type-descriptor.ts"
import { createIconifySvgIcon } from "@/components/IconifySvg.tsx"
import { cn } from "@/lib/utils"

const iconifyFileIcons = {
  bmp: fileTypeBmpIcon,
  css: fileTypeCssIcon,
  csv: fileTypeCsvIcon,
  doc: fileTypeDocIcon,
  docx: fileTypeDocxIcon,
  html: fileTypeHtmlIcon,
  jpg: fileTypeJpgIcon,
  js: fileTypeJsIcon,
  jsx: fileTypeJsxIcon,
  pdf: fileTypePdfIcon,
  php: fileTypePhpIcon,
  png: fileTypePngIcon,
  ppt: fileTypePptIcon,
  rs: fileTypeRsIcon,
  sql: fileTypeSqlIcon,
  svg: fileTypeSvgIcon,
  ts: fileTypeTsIcon,
  tsx: fileTypeTsxIcon,
  txt: fileTypeTxtIcon,
  vue: fileTypeVueIcon,
  xls: fileTypeXlsIcon,
  xml: fileTypeXmlIcon,
  zip: fileTypeZipIcon,
} satisfies Partial<Record<FileIconKey, IconifyIconData>>

const fileIconComponents = Object.fromEntries(
  Object.entries(iconifyFileIcons).map(([key, icon]) => [key, createIconifySvgIcon(icon)]),
) as Partial<Record<FileIconKey, AppIconComponent>>

function fallbackFileIcon(key: FileIconKey): AppIconComponent {
  switch (key) {
    case "archive":
      return FileArchive
    case "audio":
      return FileAudio
    case "code":
      return FileCode
    case "directory":
      return Folder
    case "doc":
    case "docx":
      return FileType
    case "image":
      return FileImage
    case "json":
      return FileJson
    case "markdown":
    case "text":
      return FileText
    case "spreadsheet":
      return FileSpreadsheet
    case "video":
      return FileVideo
    case "web_page":
      return Globe
    default:
      return File
  }
}

export function FileKindIcon({
  className,
  pack,
  source,
}: {
  className?: string
  pack?: LocalArtifactPack | null
  source: FileVisualSource | undefined
}) {
  const iconClassName = cn("size-4 shrink-0", className)
  const descriptor = fileTypeDescriptor(source, pack)
  const Icon = fileIconComponents[descriptor.iconKey] ?? fallbackFileIcon(descriptor.iconKey)
  return <Icon className={iconClassName} />
}

export function FileKindTile({
  className,
  iconClassName,
  pack,
  source,
}: {
  className?: string
  iconClassName?: string
  pack?: LocalArtifactPack | null
  source: FileVisualSource
}) {
  const { tone } = fileTypeDescriptor(source, pack)
  const tileClassName = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-md",
    `oo-attachment-tile-${tone}`,
    className,
  )
  return (
    <span className={tileClassName}>
      <FileKindIcon source={source} pack={pack} className={cn("size-5", iconClassName)} />
    </span>
  )
}
