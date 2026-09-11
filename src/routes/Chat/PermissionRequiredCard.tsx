import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

import { ChevronDown, FolderLock, RotateCw, ShieldAlert } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { permissionPresentation, permissionTargetLabel } from "./permission-presentation.ts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldLabel } from "@/components/ui/field"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

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
  // A new request must never inherit a checked grant or a pending reply.
  return (
    <PermissionCardContent
      key={`${request.sessionId}:${request.id}`}
      {...{ busy, request, onAllowOnce, onAllowForSession, onReject }}
    />
  )
}

function PermissionCardContent({
  busy = false,
  request,
  onAllowOnce,
  onAllowForSession,
  onReject,
}: PermissionRequiredCardProps) {
  const t = useT()
  const presentation = permissionPresentation(request)
  const [submitting, setSubmitting] = React.useState(false)
  const replyInFlight = React.useRef(false)
  const [remember, setRemember] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(presentation.detailsOpen)
  const titleId = React.useId()
  const rememberId = React.useId()
  const disabled = busy || submitting
  const Icon = presentation.caution ? ShieldAlert : presentation.recovery ? RotateCw : FolderLock
  const handleReply = React.useCallback(
    async (reply: "once" | "always" | "reject"): Promise<void> => {
      if (disabled || replyInFlight.current) {
        return
      }
      replyInFlight.current = true
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
        replyInFlight.current = false
        setSubmitting(false)
        reportRendererHandledError("chat", "permission reply failed", error)
        toast.error(t("chat.permissionSubmitFailed"))
      }
    },
    [disabled, onAllowForSession, onAllowOnce, onReject, request.id, t],
  )
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
            presentation.caution && "text-[var(--oo-warning-foreground)]",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id={titleId} className="oo-text-label font-medium">
              {t(presentation.title)}
            </h3>
            <p className="oo-text-body break-words text-muted-foreground">{t(presentation.description)}</p>
          </div>
          {presentation.targets.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="oo-text-caption text-muted-foreground">{t("permissionPrompt.targets")}</p>
              <ul className="flex min-w-0 flex-col gap-1">
                {presentation.targets.map((target) => {
                  const label = permissionTargetLabel(target)
                  return (
                    <li key={target} className="oo-text-caption flex min-w-0 flex-col break-all whitespace-pre-wrap">
                      <span>{label.name}</span>
                      {label.location ? <span className="text-muted-foreground">{label.location}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" type="button">
                <ChevronDown aria-hidden="true" className={cn(detailsOpen && "rotate-180")} />
                {t("permissionPrompt.details")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 flex min-w-0 flex-col gap-2 rounded-md bg-muted p-3">
                <p className="oo-text-caption break-all">{request.action}</p>
                {presentation.command ? (
                  <pre className="oo-text-caption break-all whitespace-pre-wrap">{presentation.command}</pre>
                ) : null}
                {presentation.targets.map((resource, index) => (
                  <p key={index} className="oo-text-caption break-all whitespace-pre-wrap">
                    {resource}
                  </p>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
          {presentation.repeat ? (
            <Field orientation="horizontal">
              <Checkbox
                id={rememberId}
                checked={remember}
                disabled={disabled}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              <FieldLabel htmlFor={rememberId}>{t(presentation.repeat)}</FieldLabel>
            </Field>
          ) : null}
          {remember && presentation.repeat && presentation.grantPatterns.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="oo-text-caption text-muted-foreground">{t("permissionPrompt.scope")}</p>
              {presentation.grantPatterns.map((pattern, index) => (
                <p key={index} className="oo-text-caption break-all whitespace-pre-wrap">
                  {pattern}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              onClick={() => void handleReply(remember && presentation.repeat ? "always" : "once")}
              disabled={disabled}
            >
              {t(presentation.allow)}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void handleReply("reject")}
              disabled={disabled}
            >
              {t("chat.permissionRequiredReject")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
