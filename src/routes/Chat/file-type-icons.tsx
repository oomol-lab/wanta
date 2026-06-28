import type { LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { FileVisualSource } from "./file-type-kind.ts"

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
import { fileVisualKind } from "./file-type-kind.ts"
import { cn } from "@/lib/utils"

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
  switch (fileVisualKind(source, pack)) {
    case "archive":
      return <FileArchive className={iconClassName} />
    case "audio":
      return <FileAudio className={iconClassName} />
    case "code":
      return <FileCode className={iconClassName} />
    case "directory":
      return <Folder className={iconClassName} />
    case "document":
      return <FileType className={iconClassName} />
    case "image":
      return <FileImage className={iconClassName} />
    case "json":
      return <FileJson className={iconClassName} />
    case "markdown":
    case "text":
      return <FileText className={iconClassName} />
    case "pdf":
      return <FileText className={iconClassName} />
    case "spreadsheet":
      return <FileSpreadsheet className={iconClassName} />
    case "video":
      return <FileVideo className={iconClassName} />
    case "web_page":
      return <Globe className={iconClassName} />
    default:
      return <File className={iconClassName} />
  }
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
  const kind = fileVisualKind(source, pack)
  const tileClassName = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-md",
    `oo-attachment-tile-${kind}`,
    className,
  )
  if (kind === "pdf") {
    return <span className={cn(tileClassName, "text-[9px] font-semibold")}>PDF</span>
  }
  return (
    <span className={tileClassName}>
      <FileKindIcon source={source} pack={pack} className={cn("size-5", iconClassName)} />
    </span>
  )
}
