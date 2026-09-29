import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

/** Shared by the route import fallback and the workbench's initial data load. */
export function FlowsLoading({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      className={cn("h-full overflow-hidden bg-background px-4 py-6 sm:px-6", className)}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t("flows.loading")}</span>
      <div aria-hidden="true" className="flex flex-col gap-5">
        <Skeleton className="h-6 w-28" />
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
            <Skeleton className="h-4 w-24" />
            <div className="flex min-w-0 flex-wrap gap-3">
              <Skeleton className="h-9 w-48 max-w-full" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="flex items-center gap-4 border-b px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <div className="flex-1" />
            <Skeleton className="hidden h-3 w-12 sm:block" />
            <Skeleton className="h-3 w-24" />
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-b p-4 last:border-b-0">
              <Skeleton className="size-8 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-24 max-w-full" />
              </div>
              <Skeleton className="hidden h-5 w-12 sm:block" />
              <div className="flex shrink-0 gap-2">
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-8 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
