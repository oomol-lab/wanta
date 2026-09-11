// @vitest-environment happy-dom
import type { Team } from "../../../electron/teams/common.ts"
import type { BusyAction } from "./team-management-model.ts"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { TeamProfileSettingsPanel } from "./TeamMemberDialogs.tsx"
import { useTeamForms } from "./use-team-forms.ts"

const { updateTeam, uploadTeamAvatar, translate } = vi.hoisted(() => ({
  updateTeam: vi.fn(),
  uploadTeamAvatar: vi.fn(),
  translate: (key: string) => key,
}))
vi.mock("@/lib/teams-client", () => ({ updateTeam, uploadTeamAvatar, createTeam: vi.fn() }))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: translate }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
afterEach(() => vi.clearAllMocks())
const initialTeam: Team = { id: "profile-team", name: "Original", avatar: "", creator_user_id: "owner" }
const canManage = () => true
const refresh = vi.fn()
const select = vi.fn()
async function mountProfile() {
  let forms!: ReturnType<typeof useTeamForms>
  function Probe() {
    const [team, setTeam] = React.useState(initialTeam)
    const [busyAction, setBusyAction] = React.useState<BusyAction | null>(null)
    forms = useTeamForms({
      teams: [team],
      canManageTeam: canManage,
      selectedTeamId: team.id,
      selectTeam: select,
      upsertTeam: setTeam,
      refreshWorkspace: refresh,
      busyAction,
      setBusyAction,
    })
    const edit = forms.edit
    return (
      <TeamProfileSettingsPanel
        team={team}
        avatar={edit.avatar}
        avatarFile={edit.avatarFile}
        busy={busyAction === "updateTeam"}
        editing={edit.open}
        error={edit.error}
        name={edit.name}
        nameError={edit.nameError}
        onAvatarChange={edit.setAvatar}
        onAvatarFileChange={edit.changeAvatarFile}
        onClose={() => edit.openDialog(team)}
        onEdit={() => edit.openDialog(team)}
        onNameChange={edit.setName}
        onSubmit={edit.submit}
      />
    )
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Probe />))
  await act(async () => forms.edit.openDialog(initialTeam))
  return {
    container,
    forms: () => forms,
    dispose: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const submitEvent = () => ({ preventDefault() {} }) as React.FormEvent

test("unchanged settings cannot save and reverting restores the current team without closing the form", async () => {
  const view = await mountProfile()
  try {
    expect(view.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    expect(view.container.textContent).not.toContain("teams.revertChanges")
    await act(async () => view.forms().edit.submit(submitEvent()))
    expect(updateTeam).not.toHaveBeenCalled()
    await act(async () => view.forms().edit.setName("Updated"))
    expect(view.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
    const revert = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "teams.revertChanges",
    )!
    await act(async () => revert.click())
    expect(view.forms().edit.name).toBe("Original")
    expect(view.forms().edit.open).toBe(true)
    expect(view.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  } finally {
    await view.dispose()
  }
})

test("successful saving keeps the form open and resets its dirty state", async () => {
  updateTeam.mockResolvedValue({ ...initialTeam, name: "Updated" })
  const view = await mountProfile()
  try {
    await act(async () => view.forms().edit.setName("Updated"))
    await act(async () => view.forms().edit.submit(submitEvent()))
    expect(updateTeam).toHaveBeenCalledExactlyOnceWith({ teamId: initialTeam.id, teamName: "Updated", avatar: "" })
    expect(view.forms().edit.open).toBe(true)
    expect(view.container.querySelector<HTMLInputElement>("#edit-team-name")?.value).toBe("Updated")
    expect(view.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    expect(view.container.textContent).not.toContain("teams.revertChanges")
  } finally {
    await view.dispose()
  }
})

test("a failed save keeps the draft and presents an inline error for retry", async () => {
  updateTeam.mockRejectedValueOnce(new Error("Server unavailable"))
  const view = await mountProfile()
  try {
    await act(async () => view.forms().edit.setName("Updated"))
    await act(async () => view.forms().edit.submit(submitEvent()))
    expect(view.forms().edit.name).toBe("Updated")
    expect(view.forms().edit.open).toBe(true)
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(view.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
    updateTeam.mockResolvedValueOnce({ ...initialTeam, name: "Updated" })
    await act(async () => view.forms().edit.submit(submitEvent()))
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  } finally {
    await view.dispose()
  }
})
