import type { SkillRemoveTarget } from "@/components/useSkillObjectActions"

import { AppIcons } from "@/components/AppIcons"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import { useAppI18n } from "@/i18n"

interface DeleteSkillConfirmDialogProps {
  isRemoving: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange: (isOpen: boolean) => void
  target: SkillRemoveTarget | null
}

export function DeleteSkillConfirmDialog({
  isRemoving,
  onConfirm,
  onOpenChange,
  target,
}: DeleteSkillConfirmDialogProps) {
  const { t } = useAppI18n()
  const title = t("skills.removeConfirmTitle")
  const description = target
    ? t("skills.removeConfirmDescription", { name: target.skill.name })
    : t("skills.deleteConfirmUnavailable")

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(isOpen) => {
        if (!isRemoving) {
          onOpenChange(isOpen)
        }
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{title}</ConfirmDialogTitle>
          <ConfirmDialogDescription>{description}</ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={isRemoving}>{t("skills.deleteConfirmCancel")}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={isRemoving || !target}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm()
            }}
          >
            {isRemoving ? <AppIcons.status.loading className="animate-spin" /> : null}
            {isRemoving ? t("skills.removing") : t("skills.removeConfirmAction")}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
