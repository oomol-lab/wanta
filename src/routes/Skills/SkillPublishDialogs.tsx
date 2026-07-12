import type { ManagedSkillGroup, PublishSkillResult } from "../../../electron/skills/common.ts"

import * as React from "react"
import { skillErrorMessage } from "./skill-errors.ts"
import { getLocalSkillPublishPath } from "./skill-route-model.ts"
import { AppIcons } from "@/components/AppIcons"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppI18n } from "@/i18n"

export type SkillPublishVisibility = "private" | "public"

type SkillPublishStep = "form" | "published" | "link-failed"

export type SkillOrganizationLinkTarget = {
  packageName: string
  skillName: string
  title: string
  version: string
}

export type ManagedOrganizationOption = {
  id: string
  name: string
}

export function PublishSkillDialog({
  busy,
  managedOrganizations,
  open,
  skill,
  onClose,
  onLinkOrganization,
  onPublish,
}: {
  busy: boolean
  managedOrganizations: ManagedOrganizationOption[]
  open: boolean
  skill: ManagedSkillGroup | null
  onClose: () => void
  onLinkOrganization: (target: SkillOrganizationLinkTarget, organizationId: string) => Promise<void>
  onPublish: (
    skill: ManagedSkillGroup,
    options: { visibility: SkillPublishVisibility },
  ) => Promise<PublishSkillResult | null>
}) {
  const { t } = useAppI18n()
  const [visibility, setVisibility] = React.useState<SkillPublishVisibility>("private")
  const [linkAfterPublish, setLinkAfterPublish] = React.useState(false)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [step, setStep] = React.useState<SkillPublishStep>("form")
  const [publishedTarget, setPublishedTarget] = React.useState<SkillOrganizationLinkTarget | null>(null)
  const [publishError, setPublishError] = React.useState<string | null>(null)
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [linkedOrganizationId, setLinkedOrganizationId] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const [availableOrganizations, setAvailableOrganizations] = React.useState<ManagedOrganizationOption[]>([])
  const initializedSkillIdRef = React.useRef<string | null>(null)
  const hasManagedOrganizations = availableOrganizations.length > 0
  const visibilityLabel = visibility === "private" ? t("skills.visibility.private") : t("skills.visibility.public")
  const linkedOrganization = linkedOrganizationId
    ? availableOrganizations.find((organization) => organization.id === linkedOrganizationId)
    : undefined

  React.useEffect(() => {
    if (!open) {
      initializedSkillIdRef.current = null
      setAvailableOrganizations([])
      return
    }
    const skillId = skill?.id ?? null
    if (initializedSkillIdRef.current === skillId) {
      setAvailableOrganizations(managedOrganizations)
      return
    }
    initializedSkillIdRef.current = skillId
    setVisibility("private")
    setLinkAfterPublish(false)
    setSelectedOrganizationId(managedOrganizations[0]?.id ?? "")
    setAvailableOrganizations(managedOrganizations)
    setStep("form")
    setPublishedTarget(null)
    setPublishError(null)
    setLinkError(null)
    setLinkedOrganizationId(null)
    setLinking(false)
  }, [managedOrganizations, open, skill?.id])

  React.useEffect(() => {
    if (!open || availableOrganizations.length === 0) {
      return
    }
    setSelectedOrganizationId((current) =>
      current && availableOrganizations.some((organization) => organization.id === current)
        ? current
        : (availableOrganizations[0]?.id ?? ""),
    )
  }, [availableOrganizations, open])

  const linkPublishedTarget = React.useCallback(
    async (target: SkillOrganizationLinkTarget, organizationId: string): Promise<boolean> => {
      if (!organizationId) {
        return false
      }
      setLinking(true)
      setLinkError(null)
      try {
        await onLinkOrganization(target, organizationId)
        setLinkedOrganizationId(organizationId)
        setStep("published")
        return true
      } catch (cause) {
        setStep("link-failed")
        setLinkError(skillErrorMessage(cause, t))
        return false
      } finally {
        setLinking(false)
      }
    },
    [onLinkOrganization, t],
  )

  const submitPublish = React.useCallback(async () => {
    if (!skill || busy || linking) {
      return
    }
    setPublishError(null)
    let result: PublishSkillResult | null = null
    try {
      result = await onPublish(skill, { visibility })
    } catch (cause) {
      setPublishError(skillErrorMessage(cause, t))
      return
    }
    if (!result) {
      return
    }
    const target: SkillOrganizationLinkTarget = {
      packageName: result.packageName,
      skillName: skill.id,
      title: skill.name,
      version: result.version,
    }
    setPublishedTarget(target)
    setStep("published")
    if (linkAfterPublish && selectedOrganizationId) {
      await linkPublishedTarget(target, selectedOrganizationId)
    }
  }, [busy, linkAfterPublish, linkPublishedTarget, linking, onPublish, selectedOrganizationId, skill, t, visibility])

  const footer =
    step === "form" ? (
      <>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" disabled={busy || linking} onClick={() => void submitPublish()}>
          {busy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.publish />}
          {busy ? t("skills.publishing") : t("skills.publishConfirm")}
        </Button>
      </>
    ) : (
      <>
        {publishedTarget && hasManagedOrganizations && !linkedOrganizationId ? (
          <Button
            type="button"
            variant="outline"
            disabled={linking || !selectedOrganizationId}
            onClick={() => void linkPublishedTarget(publishedTarget, selectedOrganizationId)}
          >
            {linking ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {linking ? t("skills.organizationLinking") : t("skills.organizationLink")}
          </Button>
        ) : null}
        <Button type="button" onClick={onClose} disabled={linking}>
          {t("skills.publishDoneAction")}
        </Button>
      </>
    )

  return (
    <Dialog
      open={open}
      title={t("skills.publishDialogTitle", { name: skill?.name ?? "" })}
      description={t("skills.publishDialogDescription")}
      closeLabel={t("common.cancel")}
      className="max-w-xl"
      footer={footer}
      onClose={busy || linking ? () => undefined : onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-1 rounded-md border bg-muted/30 px-3 py-2.5">
          <div className="oo-text-caption-compact font-medium">{skill?.name}</div>
          <div className="oo-text-caption min-w-0 truncate">{skill ? getLocalSkillPublishPath(skill) : ""}</div>
        </div>
        {step === "form" ? (
          <PublishForm
            availableOrganizations={availableOrganizations}
            hasManagedOrganizations={hasManagedOrganizations}
            linkAfterPublish={linkAfterPublish}
            publishError={publishError}
            selectedOrganizationId={selectedOrganizationId}
            visibility={visibility}
            onLinkAfterPublishChange={setLinkAfterPublish}
            onOrganizationChange={setSelectedOrganizationId}
            onVisibilityChange={setVisibility}
          />
        ) : (
          <PublishResult
            availableOrganizations={availableOrganizations}
            hasManagedOrganizations={hasManagedOrganizations}
            linkError={linkError}
            linkedOrganizationName={linkedOrganization?.name}
            selectedOrganizationId={selectedOrganizationId}
            showLinkError={step === "link-failed"}
            target={publishedTarget}
            visibilityLabel={visibilityLabel}
            onOrganizationChange={setSelectedOrganizationId}
          />
        )}
      </div>
    </Dialog>
  )
}

function PublishForm({
  availableOrganizations,
  hasManagedOrganizations,
  linkAfterPublish,
  publishError,
  selectedOrganizationId,
  visibility,
  onLinkAfterPublishChange,
  onOrganizationChange,
  onVisibilityChange,
}: {
  availableOrganizations: ManagedOrganizationOption[]
  hasManagedOrganizations: boolean
  linkAfterPublish: boolean
  publishError: string | null
  selectedOrganizationId: string
  visibility: SkillPublishVisibility
  onLinkAfterPublishChange: (enabled: boolean) => void
  onOrganizationChange: (organizationId: string) => void
  onVisibilityChange: (visibility: SkillPublishVisibility) => void
}) {
  const { t } = useAppI18n()
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="oo-text-label">{t("skills.publishVisibility")}</legend>
        {(["private", "public"] as const).map((option) => (
          <label
            key={option}
            className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2"
          >
            <input
              type="radio"
              name="skill-publish-visibility"
              className="mt-1"
              checked={visibility === option}
              onChange={() => onVisibilityChange(option)}
            />
            <span className="grid gap-0.5">
              <span className="oo-text-caption-compact font-medium">{t(`skills.visibility.${option}`)}</span>
              <span className="oo-text-caption">
                {t(
                  option === "private"
                    ? "skills.publishVisibilityPrivateDescription"
                    : "skills.publishVisibilityPublicDescription",
                )}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-2">
        <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={linkAfterPublish}
            disabled={!hasManagedOrganizations}
            onChange={(event) => onLinkAfterPublishChange(event.currentTarget.checked)}
          />
          <span className="grid gap-0.5">
            <span className="oo-text-caption-compact font-medium">{t("skills.publishLinkAfterPublish")}</span>
            <span className="oo-text-caption">
              {hasManagedOrganizations
                ? t("skills.publishLinkAfterPublishDescription")
                : t("skills.publishNoOrganizations")}
            </span>
          </span>
        </label>
        {linkAfterPublish && hasManagedOrganizations ? (
          <OrganizationSelect
            organizations={availableOrganizations}
            selectedOrganizationId={selectedOrganizationId}
            onChange={onOrganizationChange}
          />
        ) : null}
        {publishError ? (
          <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
            {t("skills.publishFailed", { error: publishError })}
          </div>
        ) : null}
      </div>
    </>
  )
}

function PublishResult({
  availableOrganizations,
  hasManagedOrganizations,
  linkError,
  linkedOrganizationName,
  selectedOrganizationId,
  showLinkError,
  target,
  visibilityLabel,
  onOrganizationChange,
}: {
  availableOrganizations: ManagedOrganizationOption[]
  hasManagedOrganizations: boolean
  linkError: string | null
  linkedOrganizationName?: string
  selectedOrganizationId: string
  showLinkError: boolean
  target: SkillOrganizationLinkTarget | null
  visibilityLabel: string
  onOrganizationChange: (organizationId: string) => void
}) {
  const { t } = useAppI18n()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1 rounded-md border border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-3 py-2.5">
        <div className="oo-text-caption-compact font-medium">{t("skills.publishResultTitle")}</div>
        <div className="oo-text-caption">{t("skills.publishResultDescription", { visibility: visibilityLabel })}</div>
      </div>
      {target && hasManagedOrganizations ? (
        <div className="grid gap-2">
          <div className="oo-text-label">{t("skills.organizationUse")}</div>
          {linkedOrganizationName ? (
            <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">
              {t("skills.organizationLinkedResult", { name: linkedOrganizationName })}
            </div>
          ) : (
            <OrganizationSelect
              organizations={availableOrganizations}
              selectedOrganizationId={selectedOrganizationId}
              onChange={onOrganizationChange}
            />
          )}
        </div>
      ) : null}
      {showLinkError && linkError ? (
        <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
          {t("skills.organizationLinkFailed", { error: linkError })}
        </div>
      ) : null}
    </div>
  )
}

export function OrganizationLinkDialog({
  managedOrganizations,
  open,
  target,
  onClose,
  onLinkOrganization,
}: {
  managedOrganizations: ManagedOrganizationOption[]
  open: boolean
  target: SkillOrganizationLinkTarget | null
  onClose: () => void
  onLinkOrganization: (target: SkillOrganizationLinkTarget, organizationId: string) => Promise<void>
}) {
  const { t } = useAppI18n()
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setSelectedOrganizationId(managedOrganizations[0]?.id ?? "")
    setBusy(false)
    setError(null)
  }, [managedOrganizations, open, target?.packageName])

  const submit = React.useCallback(async () => {
    if (!target || !selectedOrganizationId || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onLinkOrganization(target, selectedOrganizationId)
      onClose()
    } catch (cause) {
      setError(skillErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }, [busy, onClose, onLinkOrganization, selectedOrganizationId, t, target])

  return (
    <Dialog
      open={open}
      title={t("skills.organizationLinkDialogTitle", { name: target?.title ?? "" })}
      description={t("skills.organizationLinkDialogDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || !selectedOrganizationId || managedOrganizations.length === 0}
            onClick={() => void submit()}
          >
            {busy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {busy ? t("skills.organizationLinking") : t("skills.organizationLink")}
          </Button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
    >
      <div className="grid gap-3">
        {managedOrganizations.length > 0 ? (
          <OrganizationSelect
            organizations={managedOrganizations}
            selectedOrganizationId={selectedOrganizationId}
            onChange={setSelectedOrganizationId}
          />
        ) : (
          <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">
            {t("skills.publishNoOrganizations")}
          </div>
        )}
        {error ? (
          <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
            {t("skills.organizationLinkFailed", { error })}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function OrganizationSelect({
  organizations,
  selectedOrganizationId,
  onChange,
}: {
  organizations: ManagedOrganizationOption[]
  selectedOrganizationId: string
  onChange: (organizationId: string) => void
}) {
  const { t } = useAppI18n()
  return (
    <div className="grid gap-1.5">
      <label className="oo-text-caption-compact font-medium" htmlFor="skill-organization-link-target">
        {t("skills.organizationSelect")}
      </label>
      <Select value={selectedOrganizationId} onValueChange={onChange}>
        <SelectTrigger id="skill-organization-link-target" className="w-full">
          <SelectValue placeholder={t("organizations.selectOrganization")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
