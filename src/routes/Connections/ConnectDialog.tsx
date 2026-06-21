import type {
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionCredentialField,
  ConnectionProviderDetail,
} from "../../../electron/connections/common.ts"

import { KeyRound } from "lucide-react"
import * as React from "react"
import { Loader } from "@/components/ai-elements/loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/i18n/i18n"

const URL_RE = /(https?:\/\/[^\s）)]+)/g
const IS_URL = /^https?:\/\//
const PRIMARY_KEY = "__primary__"

type CredentialMode = "api_key" | "custom_credential" | "federated"

function LinkifiedText({ text, onOpenUrl }: { text: string; onOpenUrl: (url: string) => void }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        IS_URL.test(part) ? (
          <button
            key={`${i}-${part}`}
            type="button"
            onClick={() => onOpenUrl(part)}
            className="oo-text-accent underline underline-offset-2"
          >
            {part}
          </button>
        ) : (
          <React.Fragment key={`${i}-text`}>{part}</React.Fragment>
        ),
      )}
    </>
  )
}

function getCredentialFields(
  detail: ConnectionProviderDetail,
  authType: CredentialMode,
): { primary?: ConnectionCredentialField; fields: ConnectionCredentialField[] } {
  if (authType === "api_key") {
    const cfg = detail.apiKeyConfig
    return {
      primary: {
        key: PRIMARY_KEY,
        label: cfg?.label ?? "API Key",
        required: true,
        secret: true,
        placeholder: cfg?.placeholder,
        description: cfg?.description,
      },
      fields: cfg?.extraFields ?? [],
    }
  }

  if (authType === "federated") {
    return {
      fields: [
        { key: "oidcProviderArn", label: "OIDC Provider ARN", required: true, secret: false },
        { key: "roleArn", label: "Role ARN", required: true, secret: false },
        { key: "roleSessionName", label: "Role session name", required: false, secret: false },
        { key: "bucket", label: "Bucket", required: false, secret: false },
        { key: "durationSeconds", label: "Duration seconds", required: false, secret: false },
        { key: "policy", label: "Policy", required: false, secret: false },
      ],
    }
  }

  return { fields: detail.customCredentialConfig?.fields ?? [] }
}

function isCredentialMode(authType: ConnectionAuthType): authType is CredentialMode {
  return authType === "api_key" || authType === "custom_credential" || authType === "federated"
}

export interface ConnectDialogProps {
  open: boolean
  detail: ConnectionProviderDetail | null
  authType: CredentialMode | null
  busy: boolean
  appId?: string
  onClose: () => void
  onSubmit: (input: ConnectionConnectInput) => void
  onOpenUrl: (url: string) => void
}

export function ConnectDialog({
  open,
  detail,
  authType,
  busy,
  appId,
  onClose,
  onSubmit,
  onOpenUrl,
}: ConnectDialogProps) {
  const t = useT()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [note, setNote] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setValues({})
      setNote("")
    }
  }, [open, detail?.service, authType])

  if (!detail || !authType || !isCredentialMode(authType)) {
    return null
  }

  const { primary, fields } = getCredentialFields(detail, authType)
  const allFields = primary ? [primary, ...fields] : fields
  const missingRequired = allFields.some((field) => field.required && !(values[field.key] ?? "").trim())

  const submit = (): void => {
    const label = note.trim() || undefined
    if (authType === "api_key") {
      const extra: Record<string, string> = {}
      for (const field of fields) {
        const value = values[field.key]?.trim()
        if (value) {
          extra[field.key] = value
        }
      }
      onSubmit({
        authType: "api_key",
        service: detail.service,
        apiKey: values[PRIMARY_KEY]?.trim() ?? "",
        label,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
        appId,
      })
      return
    }

    const collected: Record<string, string> = {}
    for (const field of fields) {
      const value = values[field.key]?.trim()
      if (value) {
        collected[field.key] = value
      }
    }

    if (authType === "federated") {
      const oidcProviderArn = collected.oidcProviderArn?.trim()
      const roleArn = collected.roleArn?.trim()
      if (!oidcProviderArn || !roleArn) {
        return
      }
      onSubmit({
        authType: "federated",
        service: detail.service,
        config: {
          oidcProviderArn,
          roleArn,
          roleSessionName: collected.roleSessionName,
          bucket: collected.bucket,
          durationSeconds: collected.durationSeconds ? Number(collected.durationSeconds) : undefined,
          policy: collected.policy,
        },
        label,
        appId,
      })
      return
    }

    onSubmit({ authType: "custom_credential", service: detail.service, values: collected, label, appId })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeLabel={t("common.cancel")}
      title={t("connections.connectTitle", { name: detail.displayName })}
      footer={
        <Button className="gap-1.5" disabled={busy || missingRequired} onClick={submit}>
          {busy ? <Loader size={16} /> : <KeyRound className="size-4" />}
          {t("connections.saveConnection")}
        </Button>
      }
    >
      <div className="grid gap-4">
        {allFields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
            onOpenUrl={onOpenUrl}
          />
        ))}

        <div className="grid gap-1.5">
          <Label className="oo-text-label">{t("connections.note")}</Label>
          <Input
            value={note}
            placeholder={t("connections.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="oo-text-caption">{t("connections.noteHelp")}</span>
        </div>
      </div>
    </Dialog>
  )
}

function Field({
  field,
  value,
  onChange,
  onOpenUrl,
}: {
  field: ConnectionCredentialField
  value: string
  onChange: (value: string) => void
  onOpenUrl: (url: string) => void
}) {
  const isPolicy = field.key === "policy"
  return (
    <div className="grid gap-1.5">
      <Label className="oo-text-label flex items-center gap-1.5">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
        {field.secret && <Badge variant="outline">secret</Badge>}
      </Label>
      {isPolicy ? (
        <Textarea
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 font-mono text-xs"
        />
      ) : (
        <Input
          autoFocus={field.key === PRIMARY_KEY}
          type={field.secret ? "password" : "text"}
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description && (
        <span className="oo-text-caption">
          <LinkifiedText text={field.description} onOpenUrl={onOpenUrl} />
        </span>
      )}
    </div>
  )
}
