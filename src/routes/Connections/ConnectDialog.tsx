import type {
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionCredentialField,
  ConnectionOAuthClientConfigFieldDefinition,
  ConnectionProviderDetail,
  ConnectionUserOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"
import type { OAuthClientConfigDraft, OAuthClientConfigFieldDraftValue } from "./oauth-client-config.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { Copy, KeyRound, Save } from "lucide-react"
import * as React from "react"
import {
  buildOAuthClientConfigPayload,
  buildOAuthConnectPayload,
  buildOAuthConnectViewModel,
  createOAuthClientConfigDraft,
  getOAuthClientConfigFieldDefinitions,
  resolveProviderOAuthClientConfig,
  validateOAuthFields,
  validateOAuthPersistentFields,
} from "./oauth-client-config.ts"
import { Loader } from "@/components/ai-elements/loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { upsertOAuthClientConfig } from "@/lib/connections-client"

const URL_RE = /(https?:\/\/[^\s）)]+)/g
const IS_URL = /^https?:\/\//
const PRIMARY_KEY = "__primary__"

type CredentialMode = "api_key" | "custom_credential" | "federated"
type DialogAuthMode = CredentialMode | "oauth2"

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

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="oo-text-caption rounded-md border bg-muted/40 px-3 py-2">{children}</div>
}

function oauthBlockedReasonLabel(reason: string, t: TranslateFn): string {
  if (reason === "oauth-client-config-required") {
    return t("connections.oauthClientRequired")
  }
  return t("connections.oauthServiceUnavailable")
}

function ReadOnlyField({ description, label, value }: { description?: string; label: string; value: string }) {
  const t = useT()
  return (
    <div className="grid gap-1.5">
      <Label className="oo-text-label">{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label={t("connections.copy")}
          title={t("connections.copy")}
          onClick={() => void writeClipboardText(value)}
        >
          <Copy className="size-4" />
        </Button>
      </div>
      {description ? <span className="oo-text-caption">{description}</span> : null}
    </div>
  )
}

function OAuthClientField({
  draft,
  field,
  hasStoredSecret,
  onDraftChange,
}: {
  draft: OAuthClientConfigDraft
  field: ConnectionOAuthClientConfigFieldDefinition
  hasStoredSecret: boolean
  onDraftChange: (draft: OAuthClientConfigDraft) => void
}) {
  const t = useT()
  const record = field.location === "extra" ? draft.extra : draft.secretExtra
  const rawValue = record[field.key]
  const value = Array.isArray(rawValue) ? rawValue.join("\n") : (rawValue ?? "")
  const updateValue = (nextValue: string): void => {
    const nextRecord = {
      ...record,
      [field.key]: field.inputType === "string_array" ? nextValue.split("\n") : nextValue,
    } satisfies Record<string, OAuthClientConfigFieldDraftValue>
    onDraftChange(field.location === "extra" ? { ...draft, extra: nextRecord } : { ...draft, secretExtra: nextRecord })
  }
  const multiline = field.inputType === "textarea" || field.inputType === "string_array"

  return (
    <div className="grid gap-1.5">
      <Label className="oo-text-label flex items-center gap-1.5">
        {field.label}
        {field.required ? <span className="text-destructive">*</span> : null}
        {field.secret ? <Badge variant="outline">secret</Badge> : null}
      </Label>
      {multiline ? (
        <Textarea
          value={value}
          placeholder={field.placeholder}
          className="min-h-24"
          onChange={(event) => updateValue(event.target.value)}
        />
      ) : (
        <Input
          type={field.inputType === "password" ? "password" : "text"}
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => updateValue(event.target.value)}
        />
      )}
      {field.description || hasStoredSecret ? (
        <span className="oo-text-caption">
          {[field.description, hasStoredSecret ? t("connections.savedCredentialValue") : ""].filter(Boolean).join(" ")}
        </span>
      ) : null}
    </div>
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

function isDialogAuthMode(authType: ConnectionAuthType): authType is DialogAuthMode {
  return authType === "oauth2" || isCredentialMode(authType)
}

export interface ConnectDialogProps {
  open: boolean
  detail: ConnectionProviderDetail | null
  authType: DialogAuthMode | null
  busy: boolean
  appId?: string
  oauthClientConfig?: ConnectionUserOAuthClientConfigSummary | null
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
  oauthClientConfig,
  onClose,
  onSubmit,
  onOpenUrl,
}: ConnectDialogProps) {
  const t = useT()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [note, setNote] = React.useState("")
  const [savedOAuthClientConfig, setSavedOAuthClientConfig] =
    React.useState<ConnectionUserOAuthClientConfigSummary | null>(oauthClientConfig ?? null)
  const [oauthDraft, setOAuthDraft] = React.useState<OAuthClientConfigDraft>(() =>
    createOAuthClientConfigDraft({
      providerOAuthClientConfig: detail?.oauthClientConfig,
      userOAuthClientConfig: oauthClientConfig,
    }),
  )
  const [oauthBaselineDraft, setOAuthBaselineDraft] = React.useState<OAuthClientConfigDraft>(() =>
    createOAuthClientConfigDraft({
      providerOAuthClientConfig: detail?.oauthClientConfig,
      userOAuthClientConfig: oauthClientConfig,
    }),
  )
  const [oauthBusy, setOAuthBusy] = React.useState<"save" | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setValues({})
      setNote("")
      setFormError(null)
    }
  }, [open, detail?.service, authType])

  React.useEffect(() => {
    if (!open || authType !== "oauth2") {
      return
    }
    setSavedOAuthClientConfig(oauthClientConfig ?? null)
    const nextDraft = createOAuthClientConfigDraft({
      providerOAuthClientConfig: detail?.oauthClientConfig,
      userOAuthClientConfig: oauthClientConfig,
    })
    setOAuthDraft(nextDraft)
    setOAuthBaselineDraft(nextDraft)
    setOAuthBusy(null)
    setFormError(null)
  }, [authType, detail?.oauthClientConfig, detail?.service, oauthClientConfig, open])

  if (!detail || !authType || !isDialogAuthMode(authType)) {
    return null
  }

  if (authType === "oauth2") {
    const resolvedProviderOAuthConfig = resolveProviderOAuthClientConfig(
      detail.oauthClientConfig,
      savedOAuthClientConfig,
    )
    const fieldDefinitions = getOAuthClientConfigFieldDefinitions(resolvedProviderOAuthConfig, savedOAuthClientConfig)
    const viewModel = buildOAuthConnectViewModel({
      baselineDraft: oauthBaselineDraft,
      currentDraft: oauthDraft,
      providerOAuthClientConfig: detail.oauthClientConfig,
      userOAuthClientConfig: savedOAuthClientConfig,
    })
    const connectPayload = buildOAuthConnectPayload({ draft: oauthDraft, fieldDefinitions })
    const missingConnectFields = !validateOAuthFields(viewModel.connectOnlyFields, oauthDraft)
    const connectDisabled = busy || oauthBusy !== null || !viewModel.canConnect || missingConnectFields

    const saveOAuth = async (): Promise<void> => {
      if (!validateOAuthPersistentFields(viewModel, oauthDraft, savedOAuthClientConfig)) {
        setFormError(t("connections.fillRequiredFields"))
        return
      }

      setOAuthBusy("save")
      setFormError(null)
      try {
        const savedConfig = await upsertOAuthClientConfig(
          detail.service,
          buildOAuthClientConfigPayload({
            draft: oauthDraft,
            fieldDefinitions,
            tokenEndpointAuthMethod: resolvedProviderOAuthConfig?.tokenEndpointAuthMethod,
          }),
        )
        const nextDraft = createOAuthClientConfigDraft({
          providerOAuthClientConfig: detail.oauthClientConfig,
          userOAuthClientConfig: savedConfig,
          previousDraft: oauthDraft,
        })
        setSavedOAuthClientConfig(savedConfig)
        setOAuthDraft(nextDraft)
        setOAuthBaselineDraft(nextDraft)
      } catch (error) {
        setFormError(error instanceof Error ? error.message : String(error))
      } finally {
        setOAuthBusy(null)
      }
    }

    const submitOAuth = (): void => {
      if (connectDisabled) {
        if (missingConnectFields) {
          setFormError(t("connections.fillRequiredFields"))
        }
        return
      }
      setFormError(null)
      onSubmit({
        appId,
        authType: "oauth2",
        service: detail.service,
        extra: connectPayload.extra,
        secretExtra: connectPayload.secretExtra,
      })
    }

    return (
      <Dialog
        open={open}
        onClose={onClose}
        closeLabel={t("common.cancel")}
        title={t("connections.connectTitle", { name: detail.displayName })}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button className="gap-1.5" disabled={connectDisabled} onClick={submitOAuth}>
              {busy ? <Loader size={16} /> : <KeyRound className="size-4" />}
              {appId ? t("connections.reconnect") : t("connections.connect")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {viewModel.blockedReason ? <Notice>{oauthBlockedReasonLabel(viewModel.blockedReason, t)}</Notice> : null}
          {viewModel.persistentDirty ? <Notice>{t("connections.saveOAuthBeforeConnect")}</Notice> : null}
          {viewModel.showPersistentSection ? (
            <section className="grid gap-3 rounded-lg border p-3">
              <h3 className="oo-text-label">{t("connections.oauthClientConfig")}</h3>
              {savedOAuthClientConfig?.expectedRedirectUri ? (
                <ReadOnlyField
                  description={t("connections.redirectUriHelp")}
                  label={t("connections.redirectUri")}
                  value={savedOAuthClientConfig.expectedRedirectUri}
                />
              ) : null}
              <div className="grid gap-1.5">
                <Label className="oo-text-label">
                  {t("connections.clientId")}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  value={oauthDraft.clientId}
                  onChange={(event) => setOAuthDraft({ ...oauthDraft, clientId: event.target.value })}
                />
              </div>
              {viewModel.requiresClientSecret ? (
                <div className="grid gap-1.5">
                  <Label className="oo-text-label">
                    {t("connections.clientSecret")}
                    <span className="text-destructive"> *</span>
                  </Label>
                  <Input
                    type="password"
                    value={oauthDraft.clientSecret}
                    onChange={(event) => setOAuthDraft({ ...oauthDraft, clientSecret: event.target.value })}
                  />
                  {savedOAuthClientConfig?.clientId ? (
                    <span className="oo-text-caption">{t("connections.clientSecretHint")}</span>
                  ) : null}
                </div>
              ) : (
                <Notice>{t("connections.publicOAuthClient")}</Notice>
              )}
              {viewModel.persistentFields.map((field) => (
                <OAuthClientField
                  key={`${field.location}-${field.key}`}
                  draft={oauthDraft}
                  field={field}
                  hasStoredSecret={Boolean(savedOAuthClientConfig?.hasSecretExtra?.[field.key])}
                  onDraftChange={setOAuthDraft}
                />
              ))}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  disabled={oauthBusy !== null}
                  onClick={saveOAuth}
                >
                  {oauthBusy === "save" ? <Loader size={16} /> : <Save className="size-4" />}
                  {t("connections.saveOAuthClient")}
                </Button>
              </div>
            </section>
          ) : null}
          {viewModel.showConnectOnlySection ? (
            <section className="grid gap-3 rounded-lg border p-3">
              <h3 className="oo-text-label">{t("connections.connectOptions")}</h3>
              {viewModel.connectOnlyFields.map((field) => (
                <OAuthClientField
                  key={`${field.location}-${field.key}`}
                  draft={oauthDraft}
                  field={field}
                  hasStoredSecret={false}
                  onDraftChange={setOAuthDraft}
                />
              ))}
            </section>
          ) : null}
          {formError ? <div className="oo-text-caption text-destructive">{formError}</div> : null}
        </div>
      </Dialog>
    )
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
