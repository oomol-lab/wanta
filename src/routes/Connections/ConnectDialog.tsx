import type {
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionField,
  ConnectionProviderDetail,
} from "../../../electron/connections/common"

import { KeyRound } from "lucide-react"
import * as React from "react"
import { Loader } from "@/components/ai-elements/loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"

const URL_RE = /(https?:\/\/[^\s）)]+)/g
const IS_URL = /^https?:\/\//

/** 把文案中的 URL 渲染为可点击链接（走系统浏览器）。 */
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

const PRIMARY_KEY = "__primary__"

type FieldSpec = ConnectionField

function fieldsFor(
  detail: ConnectionProviderDetail,
  authType: ConnectionAuthType,
): {
  primary?: FieldSpec
  fields: FieldSpec[]
} {
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
    return { fields: detail.federatedCredentialConfig?.fields ?? [] }
  }
  return { fields: detail.customCredentialConfig?.fields ?? [] }
}

export interface ConnectDialogProps {
  open: boolean
  detail: ConnectionProviderDetail | null
  authType: ConnectionAuthType
  busy: boolean
  /** 存在 → 已连接账号的「重新连接」（api_key 走 by-id 端点）。 */
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

  // 每次打开/切换 provider 重置表单。
  React.useEffect(() => {
    if (open) {
      setValues({})
      setNote("")
    }
  }, [open, detail?.service, authType])

  if (!detail) {
    return null
  }

  const { primary, fields } = fieldsFor(detail, authType)
  const allFields = primary ? [primary, ...fields] : fields
  const missingRequired = allFields.some((f) => f.required && !(values[f.key] ?? "").trim())

  const submit = (): void => {
    const label = note.trim() || undefined
    if (authType === "api_key") {
      const extra: Record<string, string> = {}
      for (const f of fields) {
        const v = values[f.key]?.trim()
        if (v) {
          extra[f.key] = v
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
    for (const f of fields) {
      const v = values[f.key]?.trim()
      if (v) {
        collected[f.key] = v
      }
    }
    if (authType === "federated") {
      onSubmit({
        authType: "federated",
        service: detail.service,
        subjectTokenSource: collected.subjectTokenSource ?? "",
        target: collected.target,
        config: collected,
        label,
      })
      return
    }
    onSubmit({ authType: "custom_credential", service: detail.service, values: collected, label })
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
          {t("connections.connect")}
        </Button>
      }
    >
      <div className="grid gap-4">
        {allFields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            onOpenUrl={onOpenUrl}
          />
        ))}

        <label className="grid gap-1.5">
          <span className="oo-text-label">{t("connections.note")}</span>
          <input
            value={note}
            placeholder={t("connections.notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
            className="oo-input-surface oo-text-control h-9 w-full rounded-md border px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <span className="oo-text-caption">{t("connections.noteHelp")}</span>
        </label>
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
  field: FieldSpec
  value: string
  onChange: (v: string) => void
  onOpenUrl: (url: string) => void
}) {
  return (
    <label className="grid gap-1.5">
      <span className="oo-text-label flex items-center gap-1.5">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
        {field.secret && <Badge variant="outline">secret</Badge>}
      </span>
      <input
        autoFocus={field.key === PRIMARY_KEY}
        type={field.secret ? "password" : "text"}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="oo-input-surface oo-text-control h-9 w-full rounded-md border px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {field.description && (
        <span className="oo-text-caption">
          <LinkifiedText text={field.description} onOpenUrl={onOpenUrl} />
        </span>
      )}
    </label>
  )
}
