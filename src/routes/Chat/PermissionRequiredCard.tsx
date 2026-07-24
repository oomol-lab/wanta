import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"
import type { PermissionRequestKind } from "./permission-request.ts"

import { FolderLock, ShieldAlert, Terminal, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  isHighRiskPermissionRequest,
  isLikelyProjectDependencyInstallRequest,
  isLikelyProjectDevCommandRequest,
  isPythonDependencyPermissionRequest,
  managedPythonDependencyInstall,
  permissionCommand,
  permissionRequestHasSensitiveResource,
  permissionPrimaryResource,
  permissionRequestKind,
} from "./permission-request.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface PermissionRequiredCardProps {
  busy?: boolean
  request: ChatPermissionRequest
  onAllowOnce: (requestId: string) => Promise<void>
  onAllowForSession: (requestId: string) => Promise<void>
  onReject: (requestId: string) => Promise<void>
}

export function PermissionRequiredCard({
  busy = false,
  request,
  onAllowOnce,
  onAllowForSession,
  onReject,
}: PermissionRequiredCardProps) {
  const t = useT()
  const [submitting, setSubmitting] = React.useState(false)
  const disabled = busy || submitting
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  const resource = kind === "command" ? permissionCommand(request) : permissionPrimaryResource(request)
  const projectDevCommand = kind === "command" && isLikelyProjectDevCommandRequest(request)
  const projectDependencyInstall = isLikelyProjectDependencyInstallRequest(request)
  const pythonDependencyInstall = managedPythonDependencyInstall(request)
  const pythonDependencyRequest = isPythonDependencyPermissionRequest(request)
  const sensitiveResource = permissionRequestHasSensitiveResource(request)
  const taskScopedDependencyInstall = Boolean(
    (pythonDependencyInstall || projectDependencyInstall) && !sensitiveResource,
  )
  const canAllowForSession = Boolean(
    (!highRisk || taskScopedDependencyInstall) &&
    !sensitiveResource &&
    (request.save?.length || request.resources.length || (kind === "command" && resource)),
  )
  const Icon = kind === "command" ? Terminal : kind === "path" || kind === "edit" ? FolderLock : ShieldAlert
  const copyByKind: Record<
    PermissionRequestKind,
    { allowForSessionLabel: string; description: string; title: string }
  > = {
    command: {
      allowForSessionLabel: projectDevCommand
        ? t("chat.permissionRequiredAllowProjectDevSession")
        : t("chat.permissionRequiredAllowCommandSession"),
      description: t("chat.permissionCommandDescription", { command: resource ?? request.action }),
      title: t("chat.permissionCommandTitle"),
    },
    edit: {
      allowForSessionLabel: t("chat.permissionRequiredAllowEditSession"),
      description: t("chat.permissionEditDescription", { path: resource ?? request.action }),
      title: t("chat.permissionEditTitle"),
    },
    local: {
      allowForSessionLabel: t("chat.permissionRequiredAllowSession"),
      description: t("chat.permissionRequiredDescription"),
      title: t("chat.permissionRequiredTitle"),
    },
    network: {
      allowForSessionLabel: t("chat.permissionRequiredAllowSession"),
      description: t("chat.permissionRequiredDescription"),
      title: t("chat.permissionRequiredTitle"),
    },
    path: {
      allowForSessionLabel: t("chat.permissionRequiredAllowPathSession"),
      description: t("chat.permissionPathDescription", { path: resource ?? request.action }),
      title: t("chat.permissionPathTitle"),
    },
  }
  const copy = sensitiveResource
    ? {
        ...copyByKind[kind],
        description: t("chat.permissionSensitiveDataDescription", { resource: resource ?? request.action }),
        title: t("chat.permissionSensitiveDataTitle"),
      }
    : pythonDependencyInstall
      ? {
          ...copyByKind.command,
          allowForSessionLabel: t("chat.permissionRequiredAllowPythonDependenciesTask"),
          description: t("chat.permissionPythonDependencyDescription", {
            packages: pythonDependencyInstall.packages.join(", "),
          }),
          title: t("chat.permissionPythonDependencyTitle"),
        }
      : projectDependencyInstall
        ? {
            ...copyByKind.command,
            allowForSessionLabel: t("chat.permissionRequiredAllowProjectDependenciesTask"),
            description: t("chat.permissionProjectDependencyDescription", { command: resource ?? request.action }),
            title: t("chat.permissionProjectDependencyTitle"),
          }
        : highRisk
          ? {
              ...copyByKind[kind],
              description: t("chat.permissionHighRiskDescription", { command: resource ?? request.action }),
              title: t("chat.permissionHighRiskTitle"),
            }
          : pythonDependencyRequest
            ? {
                ...copyByKind.command,
                description: t("chat.permissionPythonDependencyBoundaryDescription", {
                  command: resource ?? request.action,
                }),
                title: t("chat.permissionPythonDependencyTitle"),
              }
            : copyByKind[kind]
  React.useEffect(() => {
    setSubmitting(false)
  }, [request.id])
  const handleReply = React.useCallback(
    async (reply: "once" | "always" | "reject"): Promise<void> => {
      if (disabled) {
        return
      }
      setSubmitting(true)
      try {
        if (reply === "once") {
          await onAllowOnce(request.id)
        } else if (reply === "always") {
          await onAllowForSession(request.id)
        } else {
          await onReject(request.id)
        }
      } catch (error) {
        setSubmitting(false)
        reportRendererHandledError("chat", "permission reply failed", error)
        toast.error(t("chat.permissionSubmitFailed"))
      }
    },
    [disabled, onAllowForSession, onAllowOnce, onReject, request.id, t],
  )
  return (
    <section className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[var(--oo-warning-foreground)]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="min-w-0">
            <h3 className="oo-text-label font-medium">{copy.title}</h3>
            <p className="oo-text-caption break-words whitespace-pre-line text-muted-foreground">{copy.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {taskScopedDependencyInstall ? (
              <>
                <Button size="sm" onClick={() => void handleReply("always")} disabled={disabled}>
                  <Terminal className="size-4" />
                  {copy.allowForSessionLabel}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleReply("once")} disabled={disabled}>
                  <ShieldAlert className="size-4" />
                  {t("chat.permissionRequiredAllowOnce")}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => void handleReply("once")} disabled={disabled}>
                  <ShieldAlert className="size-4" />
                  {t("chat.permissionRequiredAllowOnce")}
                </Button>
                {canAllowForSession ? (
                  <Button size="sm" variant="outline" onClick={() => void handleReply("always")} disabled={disabled}>
                    <Icon className="size-4" />
                    {copy.allowForSessionLabel}
                  </Button>
                ) : null}
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => void handleReply("reject")} disabled={disabled}>
              <X className="size-4" />
              {t("chat.permissionRequiredReject")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
