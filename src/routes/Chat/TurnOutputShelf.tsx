import type { TurnOutputRecord } from "../../../electron/chat/common.ts"
import type { TurnOutputSelection } from "./TurnOutputs.tsx"

import { CheckSquare, ChevronDown, ChevronRight, FileDiff } from "lucide-react"
import * as React from "react"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { FileKindTile } from "@/routes/Chat/file-type-icons"

const previewFileLimit = 3

function ChangeCountLabel({
  additions,
  className,
  deletions,
}: {
  additions: number
  className?: string
  deletions: number
}) {
  if (additions === 0 && deletions === 0) {
    return null
  }
  return (
    <span className={cn("oo-text-caption-compact inline-flex min-w-0 items-center gap-1 tabular-nums", className)}>
      <span className="font-medium text-[color:var(--success)]">+{additions}</span>
      <span className="font-medium text-[color:var(--destructive)]">-{deletions}</span>
    </span>
  )
}

function reviewFileDisplayPath(filePath: string, projectRoot: string | undefined): string {
  const normalized = filePath.replaceAll("\\", "/")
  const normalizedRoot = projectRoot?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (normalizedRoot && (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`))) {
    const relative = normalized.slice(normalizedRoot.length).replace(/^\/+/, "")
    if (relative) {
      return relative
    }
  }
  const codeIndex = normalized.indexOf("/code/")
  if (codeIndex >= 0) {
    const fromProject = normalized.slice(codeIndex + "/code/".length)
    if (fromProject) {
      return fromProject
    }
  }
  const parts = normalized.split("/").filter(Boolean)
  return parts.slice(-3).join("/") || filePath
}

function changeFiles(record: TurnOutputRecord) {
  return record.files.filter((file) => file.role === "project_change")
}

function processFiles(record: TurnOutputRecord) {
  return record.files.filter((file) => file.role === "process")
}

function fileTotals(files: ReturnType<typeof changeFiles>): { additions: number; deletions: number } {
  return files.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
}

function TurnOutputFilePreviewRow({
  file,
  onOpen,
  projectRoot,
}: {
  file: ReturnType<typeof changeFiles>[number]
  onOpen: () => void
  projectRoot?: string
}) {
  return (
    <button
      type="button"
      title={file.path}
      className="group/file-row grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={onOpen}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FileKindTile source={{ ...file, kind: "file" }} className="size-6" iconClassName="size-3.5" />
        <span className="oo-text-label min-w-0 truncate font-mono text-foreground">
          {reviewFileDisplayPath(file.path, projectRoot)}
        </span>
      </span>
      <ChangeCountLabel additions={file.additions} className="justify-end" deletions={file.deletions} />
    </button>
  )
}

export function TurnOutputShelf({
  record,
  onOpen,
}: {
  record: TurnOutputRecord
  onOpen: (selection: TurnOutputSelection) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const projectChangeFiles = React.useMemo(() => changeFiles(record), [record])
  const intermediateFiles = React.useMemo(() => processFiles(record), [record])
  const hasProjectChanges = projectChangeFiles.length > 0
  const hasProcessFiles = intermediateFiles.length > 0
  const visibleFiles = expanded ? projectChangeFiles : projectChangeFiles.slice(0, previewFileLimit)
  const hiddenCount = projectChangeFiles.length - visibleFiles.length
  const totals = React.useMemo(() => fileTotals(projectChangeFiles), [projectChangeFiles])

  if (!hasProjectChanges && !hasProcessFiles) {
    return null
  }

  if (!hasProjectChanges) {
    return (
      <div className="not-prose mt-2 w-full min-w-0 rounded-lg border border-border bg-background">
        <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <CheckSquare className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="oo-text-label truncate text-foreground">
                {t("turnOutputs.processSummary", { count: intermediateFiles.length })}
              </div>
              <div className="oo-text-caption-compact truncate text-muted-foreground">
                {t("turnOutputs.reviewProcessFiles")}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="oo-text-control flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => onOpen({ record, initialRole: "process" })}
          >
            {t("turnOutputs.reviewChanges")}
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="not-prose mt-2 w-full min-w-0 rounded-lg border border-border bg-background">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileDiff className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="oo-text-label flex min-w-0 items-center gap-2 text-foreground">
              <span className="min-w-0 truncate">
                {t("turnOutputs.editedSummary", { count: projectChangeFiles.length })}
              </span>
            </div>
            <ChangeCountLabel additions={totals.additions} deletions={totals.deletions} />
          </div>
        </div>
        <button
          type="button"
          className="oo-text-control flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpen({ record, initialRole: "project_change" })}
        >
          {t("turnOutputs.reviewChanges")}
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      <div className="grid gap-1 px-3 py-2">
        {visibleFiles.map((file) => (
          <TurnOutputFilePreviewRow
            key={file.path}
            file={file}
            projectRoot={record.projectRoot}
            onOpen={() => onOpen({ record, initialRole: "project_change", selectedPath: file.path })}
          />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="oo-text-label flex h-9 w-fit min-w-0 items-center gap-2 rounded-md px-2 font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setExpanded(true)}
          >
            {t("turnOutputs.showMoreFiles", { count: hiddenCount })}
            <ChevronDown className="size-4 shrink-0" />
          </button>
        ) : null}
      </div>

      {hasProcessFiles ? (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            className="oo-text-caption-compact flex h-8 min-w-0 items-center gap-1 rounded-md px-2 font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => onOpen({ record, initialRole: "process" })}
          >
            <span className="min-w-0 truncate">
              {t("turnOutputs.viewProcess", { count: intermediateFiles.length })}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
