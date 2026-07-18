import type { UseAuth } from "@/hooks/useAuth"

import { AppShell } from "@/components/app-shell/AppShell"
import { AppDataProvider } from "@/components/AppDataProvider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AuthenticatedAppShell({ auth }: { auth: UseAuth }) {
  return (
    <AppDataProvider>
      <TooltipProvider>
        <AppShell auth={auth} />
        <Toaster />
      </TooltipProvider>
    </AppDataProvider>
  )
}
