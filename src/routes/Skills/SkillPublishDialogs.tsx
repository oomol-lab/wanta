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

export type SkillTeamLinkTarget = {
  packageName: string
  skillName: string
  title: string
  version: string
}

export type ManagedTeamOption = {
  id: string
  name: string
}

export function PublishSkillDialog({
  busy,
  managedTeams,
  open,
  skill,
  onClose,
  onLinkTeam,
  onPublish,
}: {
  busy: boolean
  managedTeams: ManagedTeamOption[]
  open: boolean
  skill: ManagedSkillGroup | null
  onClose: () => void
  onLinkTeam: (target: SkillTeamLinkTarget, teamId: string) => Promise<void>
  onPublish: (
    skill: ManagedSkillGroup,
    options: { visibility: SkillPublishVisibility },
  ) => Promise<PublishSkillResult | null>
}) {
  const { t } = useAppI18n()
  const [visibility, setVisibility] = React.useState<SkillPublishVisibility>("private")
  const [linkAfterPublish, setLinkAfterPublish] = React.useState(false)
  const [selectedTeamId, setSelectedTeamId] = React.useState("")
  const [step, setStep] = React.useState<SkillPublishStep>("form")
  const [publishedTarget, setPublishedTarget] = React.useState<SkillTeamLinkTarget | null>(null)
  const [publishError, setPublishError] = React.useState<string | null>(null)
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [linkedTeamId, setLinkedTeamId] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const [availableTeams, setAvailableTeams] = React.useState<ManagedTeamOption[]>([])
  const initializedSkillIdRef = React.useRef<string | null>(null)
  const hasManagedTeams = availableTeams.length > 0
  const visibilityLabel = visibility === "private" ? t("skills.visibility.private") : t("skills.visibility.public")
  const linkedTeam = linkedTeamId ? availableTeams.find((team) => team.id === linkedTeamId) : undefined

  React.useEffect(() => {
    if (!open) {
      initializedSkillIdRef.current = null
      setAvailableTeams([])
      return
    }
    const skillId = skill?.id ?? null
    if (initializedSkillIdRef.current === skillId) {
      setAvailableTeams(managedTeams)
      return
    }
    initializedSkillIdRef.current = skillId
    setVisibility("private")
    setLinkAfterPublish(false)
    setSelectedTeamId(managedTeams[0]?.id ?? "")
    setAvailableTeams(managedTeams)
    setStep("form")
    setPublishedTarget(null)
    setPublishError(null)
    setLinkError(null)
    setLinkedTeamId(null)
    setLinking(false)
  }, [managedTeams, open, skill?.id])

  React.useEffect(() => {
    if (!open || availableTeams.length === 0) {
      return
    }
    setSelectedTeamId((current) =>
      current && availableTeams.some((team) => team.id === current) ? current : (availableTeams[0]?.id ?? ""),
    )
  }, [availableTeams, open])

  const linkPublishedTarget = React.useCallback(
    async (target: SkillTeamLinkTarget, teamId: string): Promise<boolean> => {
      if (!teamId) {
        return false
      }
      setLinking(true)
      setLinkError(null)
      try {
        await onLinkTeam(target, teamId)
        setLinkedTeamId(teamId)
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
    [onLinkTeam, t],
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
    const target: SkillTeamLinkTarget = {
      packageName: result.packageName,
      skillName: skill.id,
      title: skill.name,
      version: result.version,
    }
    setPublishedTarget(target)
    setStep("published")
    if (linkAfterPublish && selectedTeamId) {
      await linkPublishedTarget(target, selectedTeamId)
    }
  }, [busy, linkAfterPublish, linkPublishedTarget, linking, onPublish, selectedTeamId, skill, t, visibility])

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
        {publishedTarget && hasManagedTeams && !linkedTeamId ? (
          <Button
            type="button"
            variant="outline"
            disabled={linking || !selectedTeamId}
            onClick={() => void linkPublishedTarget(publishedTarget, selectedTeamId)}
          >
            {linking ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {linking ? t("skills.teamLinking") : t("skills.teamLink")}
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
            availableTeams={availableTeams}
            hasManagedTeams={hasManagedTeams}
            linkAfterPublish={linkAfterPublish}
            publishError={publishError}
            selectedTeamId={selectedTeamId}
            visibility={visibility}
            onLinkAfterPublishChange={setLinkAfterPublish}
            onTeamChange={setSelectedTeamId}
            onVisibilityChange={setVisibility}
          />
        ) : (
          <PublishResult
            availableTeams={availableTeams}
            hasManagedTeams={hasManagedTeams}
            linkError={linkError}
            linkedTeamName={linkedTeam?.name}
            selectedTeamId={selectedTeamId}
            showLinkError={step === "link-failed"}
            target={publishedTarget}
            visibilityLabel={visibilityLabel}
            onTeamChange={setSelectedTeamId}
          />
        )}
      </div>
    </Dialog>
  )
}

function PublishForm({
  availableTeams,
  hasManagedTeams,
  linkAfterPublish,
  publishError,
  selectedTeamId,
  visibility,
  onLinkAfterPublishChange,
  onTeamChange,
  onVisibilityChange,
}: {
  availableTeams: ManagedTeamOption[]
  hasManagedTeams: boolean
  linkAfterPublish: boolean
  publishError: string | null
  selectedTeamId: string
  visibility: SkillPublishVisibility
  onLinkAfterPublishChange: (enabled: boolean) => void
  onTeamChange: (teamId: string) => void
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
            disabled={!hasManagedTeams}
            onChange={(event) => onLinkAfterPublishChange(event.currentTarget.checked)}
          />
          <span className="grid gap-0.5">
            <span className="oo-text-caption-compact font-medium">{t("skills.publishLinkAfterPublish")}</span>
            <span className="oo-text-caption">
              {hasManagedTeams ? t("skills.publishLinkAfterPublishDescription") : t("skills.publishNoTeams")}
            </span>
          </span>
        </label>
        {linkAfterPublish && hasManagedTeams ? (
          <TeamSelect teams={availableTeams} selectedTeamId={selectedTeamId} onChange={onTeamChange} />
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
  availableTeams,
  hasManagedTeams,
  linkError,
  linkedTeamName,
  selectedTeamId,
  showLinkError,
  target,
  visibilityLabel,
  onTeamChange,
}: {
  availableTeams: ManagedTeamOption[]
  hasManagedTeams: boolean
  linkError: string | null
  linkedTeamName?: string
  selectedTeamId: string
  showLinkError: boolean
  target: SkillTeamLinkTarget | null
  visibilityLabel: string
  onTeamChange: (teamId: string) => void
}) {
  const { t } = useAppI18n()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1 rounded-md border border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-3 py-2.5">
        <div className="oo-text-caption-compact font-medium">{t("skills.publishResultTitle")}</div>
        <div className="oo-text-caption">{t("skills.publishResultDescription", { visibility: visibilityLabel })}</div>
      </div>
      {target && hasManagedTeams ? (
        <div className="grid gap-2">
          <div className="oo-text-label">{t("skills.teamUse")}</div>
          {linkedTeamName ? (
            <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">
              {t("skills.teamLinkedResult", { name: linkedTeamName })}
            </div>
          ) : (
            <TeamSelect teams={availableTeams} selectedTeamId={selectedTeamId} onChange={onTeamChange} />
          )}
        </div>
      ) : null}
      {showLinkError && linkError ? (
        <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
          {t("skills.teamLinkFailed", { error: linkError })}
        </div>
      ) : null}
    </div>
  )
}

export function TeamLinkDialog({
  managedTeams,
  open,
  target,
  onClose,
  onLinkTeam,
}: {
  managedTeams: ManagedTeamOption[]
  open: boolean
  target: SkillTeamLinkTarget | null
  onClose: () => void
  onLinkTeam: (target: SkillTeamLinkTarget, teamId: string) => Promise<void>
}) {
  const { t } = useAppI18n()
  const [selectedTeamId, setSelectedTeamId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setSelectedTeamId(managedTeams[0]?.id ?? "")
    setBusy(false)
    setError(null)
  }, [managedTeams, open, target?.packageName])

  const submit = React.useCallback(async () => {
    if (!target || !selectedTeamId || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onLinkTeam(target, selectedTeamId)
      onClose()
    } catch (cause) {
      setError(skillErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }, [busy, onClose, onLinkTeam, selectedTeamId, t, target])

  return (
    <Dialog
      open={open}
      title={t("skills.teamLinkDialogTitle", { name: target?.title ?? "" })}
      description={t("skills.teamLinkDialogDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || !selectedTeamId || managedTeams.length === 0}
            onClick={() => void submit()}
          >
            {busy ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.action.share />}
            {busy ? t("skills.teamLinking") : t("skills.teamLink")}
          </Button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
    >
      <div className="grid gap-3">
        {managedTeams.length > 0 ? (
          <TeamSelect teams={managedTeams} selectedTeamId={selectedTeamId} onChange={setSelectedTeamId} />
        ) : (
          <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5">{t("skills.publishNoTeams")}</div>
        )}
        {error ? (
          <div className="rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-3 py-2 text-sm text-destructive">
            {t("skills.teamLinkFailed", { error })}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function TeamSelect({
  teams,
  selectedTeamId,
  onChange,
}: {
  teams: ManagedTeamOption[]
  selectedTeamId: string
  onChange: (teamId: string) => void
}) {
  const { t } = useAppI18n()
  return (
    <div className="grid gap-1.5">
      <label className="oo-text-caption-compact font-medium" htmlFor="skill-team-link-target">
        {t("skills.teamSelect")}
      </label>
      <Select value={selectedTeamId} onValueChange={onChange}>
        <SelectTrigger id="skill-team-link-target" className="w-full">
          <SelectValue placeholder={t("teams.selectTeam")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
