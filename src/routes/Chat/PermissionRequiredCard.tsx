import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

import { FolderLock, ShieldAlert, Terminal, X } from "lucide-react"
import {
  isHighRiskPermissionRequest,
  permissionCommand,
  permissionPrimaryResource,
  permissionRequestKind,
} from "./permission-request.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

interface PermissionRequiredCardProps {
  busy?: boolean
  request: ChatPermissionRequest
  onAllowOnce: (requestId: string) => void
  onAllowForSession: (requestId: string) => void
  onReject: (requestId: string) => void
}

export function PermissionRequiredCard({
  busy = false,
  request,
  onAllowOnce,
  onAllowForSession,
  onReject,
}: PermissionRequiredCardProps) {
  const t = useT()
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  const resource = kind === "command" ? permissionCommand(request) : permissionPrimaryResource(request)
  const canAllowForSession = Boolean(!highRisk && (request.save?.length || request.resources.length))
  const Icon = kind === "command" ? Terminal : kind === "path" || kind === "edit" ? FolderLock : ShieldAlert
  const title = highRisk
    ? t("chat.permissionHighRiskTitle")
    : kind === "command"
      ? t("chat.permissionCommandTitle")
      : kind === "edit"
        ? t("chat.permissionEditTitle")
        : kind === "path"
          ? t("chat.permissionPathTitle")
          : t("chat.permissionRequiredTitle")
  const description = highRisk
    ? t("chat.permissionHighRiskDescription", { command: resource ?? request.action })
    : kind === "command"
      ? t("chat.permissionCommandDescription", { command: resource ?? request.action })
      : kind === "edit"
        ? t("chat.permissionEditDescription", { path: resource ?? request.action })
        : kind === "path"
          ? t("chat.permissionPathDescription", { path: resource ?? request.action })
          : t("chat.permissionRequiredDescription")
  const allowForSessionLabel =
    kind === "command"
      ? t("chat.permissionRequiredAllowCommandSession")
      : kind === "edit"
        ? t("chat.permissionRequiredAllowEditSession")
        : kind === "path"
          ? t("chat.permissionRequiredAllowPathSession")
          : t("chat.permissionRequiredAllowSession")
  return (
    <section className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[var(--oo-warning-foreground)]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="min-w-0">
            <h3 className="oo-text-label font-medium">{title}</h3>
            <p className="oo-text-caption break-words whitespace-pre-line text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onAllowOnce(request.id)} disabled={busy}>
              <ShieldAlert className="size-4" />
              {t("chat.permissionRequiredAllowOnce")}
            </Button>
            {canAllowForSession ? (
              <Button size="sm" variant="outline" onClick={() => onAllowForSession(request.id)} disabled={busy}>
                <Icon className="size-4" />
                {allowForSessionLabel}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => onReject(request.id)} disabled={busy}>
              <X className="size-4" />
              {t("chat.permissionRequiredReject")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
