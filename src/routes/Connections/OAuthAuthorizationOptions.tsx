import type { ConnectionOAuthAuthorizationOption } from "../../../electron/connections/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { TriangleAlert } from "lucide-react"
import * as React from "react"
import {
  getOAuthAuthorizationOptionChanges,
  isOAuthAuthorizationOptionLocked,
  updateOAuthAuthorizationOptionIds,
} from "./oauth-authorization-options.ts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { useT } from "@/i18n/i18n"

export function OAuthAuthorizationOptions({
  currentScopes,
  onChange,
  options,
  selectedIds,
}: {
  currentScopes?: readonly string[]
  onChange: (ids: string[]) => void
  options: readonly ConnectionOAuthAuthorizationOption[]
  selectedIds: readonly string[]
}) {
  const t = useT()
  const idPrefix = React.useId()
  const selected = new Set(selectedIds)
  const changes = getOAuthAuthorizationOptionChanges(options, currentScopes, selectedIds)
  const optionById = new Map(options.map((option) => [option.id, option]))
  const destructiveSelected = options.some((option) => option.risk === "destructive" && selected.has(option.id))

  const formatOptionIds = (ids: readonly string[]): string => {
    return ids.map((id) => optionById.get(id)?.label ?? id).join(", ")
  }

  return (
    <FieldSet className="rounded-lg border p-3">
      <FieldLegend>{t("connections.oauthAuthorizationOptions")}</FieldLegend>
      <FieldDescription>{t("connections.oauthAuthorizationOptionsDescription")}</FieldDescription>
      <div className="flex flex-col divide-y">
        {options.map((option, index) => {
          const id = `${idPrefix}-${index}`
          const locked = isOAuthAuthorizationOptionLocked(options, selectedIds, option.id)
          return (
            <Field key={option.id} orientation="horizontal" data-disabled={locked || undefined} className="py-3">
              <Checkbox
                id={id}
                checked={selected.has(option.id)}
                disabled={locked}
                onCheckedChange={(checked) =>
                  onChange(updateOAuthAuthorizationOptionIds(options, selectedIds, option.id, checked === true))
                }
              />
              <FieldContent>
                <FieldLabel htmlFor={id}>
                  {option.label}
                  <AuthorizationOptionBadges locked={locked} option={option} t={t} />
                </FieldLabel>
                <FieldDescription>{option.description}</FieldDescription>
              </FieldContent>
            </Field>
          )
        })}
      </div>
      {currentScopes && (changes.added.length > 0 || changes.removed.length > 0) ? (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {changes.added.length > 0 ? (
            <div>{t("connections.oauthAuthorizationAdded", { options: formatOptionIds(changes.added) })}</div>
          ) : null}
          {changes.removed.length > 0 ? (
            <div>{t("connections.oauthAuthorizationRemoved", { options: formatOptionIds(changes.removed) })}</div>
          ) : null}
        </div>
      ) : null}
      {destructiveSelected ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("connections.oauthDestructiveWarningTitle")}</AlertTitle>
          <AlertDescription>{t("connections.oauthDestructiveWarningDescription")}</AlertDescription>
        </Alert>
      ) : null}
    </FieldSet>
  )
}

function AuthorizationOptionBadges({
  locked,
  option,
  t,
}: {
  locked: boolean
  option: ConnectionOAuthAuthorizationOption
  t: TranslateFn
}) {
  return (
    <span className="flex items-center gap-1">
      {option.required ? <Badge variant="secondary">{t("connections.oauthAuthorizationRequired")}</Badge> : null}
      {!option.required && locked ? (
        <Badge variant="secondary">{t("connections.oauthAuthorizationDependency")}</Badge>
      ) : null}
      {option.risk === "sensitive" ? (
        <Badge variant="outline">{t("connections.oauthAuthorizationSensitive")}</Badge>
      ) : null}
      {option.risk === "destructive" ? (
        <Badge variant="destructive">{t("connections.oauthAuthorizationDestructive")}</Badge>
      ) : null}
    </span>
  )
}
