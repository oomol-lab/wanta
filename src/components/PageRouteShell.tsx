import { ArrowLeftIcon } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export function PageRouteShell({
  backLabel,
  children,
  contentClassName,
  onBack,
}: {
  backLabel: string
  children: React.ReactNode
  contentClassName?: string
  onBack: () => void
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] bg-background text-foreground">
      <header className="oo-page-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b [-webkit-app-region:drag]">
        <button
          type="button"
          onClick={onBack}
          className="oo-sidebar-nav-item oo-text-control flex h-8 w-fit items-center gap-2 rounded-md px-2 text-muted-foreground [-webkit-app-region:no-drag] hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          <span>{backLabel}</span>
        </button>
      </header>

      <main className="min-h-0 overflow-y-auto">
        <div
          className={cn(
            "mx-auto grid w-full max-w-[110rem] gap-6 px-10 pt-10 pb-16 max-[760px]:px-5 max-[760px]:pt-8",
            contentClassName,
          )}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
