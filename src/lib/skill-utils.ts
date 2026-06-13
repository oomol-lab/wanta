import type { ManagedSkillGroup } from "../../electron/skills/common"

export function getInstalledSkillHosts(group: ManagedSkillGroup) {
  return group.hosts.filter((host) => host.status === "installed")
}

export function getPrimarySkillPath(group: ManagedSkillGroup): string | undefined {
  return getInstalledSkillHosts(group)[0]?.path
}

export function getPrimarySkillSourcePath(group: ManagedSkillGroup): string | undefined {
  return getInstalledSkillHosts(group)[0]?.sourcePath ?? getPrimarySkillPath(group)
}
