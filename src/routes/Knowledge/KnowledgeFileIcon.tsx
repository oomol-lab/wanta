import { BookOpenText } from "lucide-react"
import { FileKindTile } from "@/routes/Chat/file-type-icons"
import { fileNameExtension } from "@/routes/Chat/file-type-kind"

export function KnowledgeFileIcon({ name }: { name: string }) {
  const extension = fileNameExtension(name)
  if (extension === "epub" || extension === "mobi") {
    return (
      <span
        className="oo-attachment-tile-document flex size-12 shrink-0 items-center justify-center rounded-xl border border-current/10"
        aria-hidden="true"
      >
        <BookOpenText className="size-6" />
      </span>
    )
  }

  return (
    <FileKindTile
      source={{ name, mime: "application/octet-stream" }}
      className="size-12 rounded-xl border border-current/10"
      iconClassName="size-7"
    />
  )
}
