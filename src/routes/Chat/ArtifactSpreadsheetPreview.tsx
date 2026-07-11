import type { LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"

import * as React from "react"
import {
  spreadsheetColumnLabel,
  spreadsheetDisplayedColumnCount,
  spreadsheetPreviewSheets,
} from "./artifact-spreadsheet-preview.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export default function ArtifactSpreadsheetPreview({
  className,
  preview,
}: {
  className?: string
  preview: LocalArtifactPreviewResult
}) {
  const t = useT()
  const sheets = React.useMemo(() => spreadsheetPreviewSheets(preview), [preview])
  const [activeSheetIndex, setActiveSheetIndex] = React.useState(0)

  React.useEffect(() => {
    setActiveSheetIndex(0)
  }, [preview])

  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(sheets.length - 1, 0))]
  if (!activeSheet) {
    return null
  }

  const displayedColumnCount = spreadsheetDisplayedColumnCount(activeSheet.rows)
  const displayedRows = activeSheet.rows.length > 0 ? activeSheet.rows : [[]]

  return (
    <div className={cn("flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]", className)}>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table
          className="oo-border-divider table-fixed border-separate border-spacing-0 overflow-hidden rounded-md border bg-background text-xs"
          style={{ width: 48 + displayedColumnCount * 112 }}
        >
          <colgroup>
            <col className="w-12" />
            {Array.from({ length: displayedColumnCount }, (_, index) => (
              <col key={index} className="w-28" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="oo-border-divider sticky top-0 left-0 z-30 h-7 border-r border-b bg-muted px-2" />
              {Array.from({ length: displayedColumnCount }, (_, index) => (
                <th
                  key={index}
                  className="oo-border-divider sticky top-0 z-20 h-7 border-r border-b bg-muted px-2 text-center font-medium text-muted-foreground last:border-r-0"
                >
                  {spreadsheetColumnLabel(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="oo-border-divider sticky left-0 z-10 h-7 border-r border-b bg-muted px-2 text-right font-medium text-muted-foreground">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: displayedColumnCount }, (_, columnIndex) => (
                  <td
                    key={columnIndex}
                    title={row[columnIndex] || undefined}
                    className="oo-border-divider h-7 overflow-hidden border-r border-b px-2 text-ellipsis whitespace-nowrap last:border-r-0"
                  >
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheets.length > 1 ? (
        <div className="oo-border-divider flex shrink-0 gap-1 overflow-x-auto border-t bg-background px-2 py-1.5">
          {sheets.map((sheet, index) => (
            <button
              key={`${sheet.name}:${index}`}
              type="button"
              className={cn(
                "h-7 max-w-48 shrink-0 truncate rounded px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                index === activeSheetIndex && "bg-accent font-medium text-foreground",
              )}
              title={sheet.name || `Sheet ${index + 1}`}
              onClick={() => setActiveSheetIndex(index)}
            >
              {sheet.name || `Sheet ${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      {preview.truncated ? (
        <p className="oo-text-caption oo-border-divider shrink-0 border-t px-3 py-2 text-muted-foreground">
          {t("artifacts.sheetTruncated")}
        </p>
      ) : null}
    </div>
  )
}
