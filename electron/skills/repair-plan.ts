import type { ManagedSkillGroup, SkillRepairPlan, SkillRepairPlanRequest, SkillRepairPlanTarget } from "./common.ts"

function createPlanId(request: SkillRepairPlanRequest): string {
  return [request.kind, request.skillId, request.agentId ?? "all"].join(":")
}

function createBasePlan(request: SkillRepairPlanRequest, group: ManagedSkillGroup): SkillRepairPlan {
  return {
    id: createPlanId(request),
    kind: request.kind,
    status: "not-needed",
    skillId: group.id,
    skillName: group.name,
    isDestructive: request.kind === "reset",
    requiresConfirmation: false,
    targets: [],
    packageName: group.packageName,
    version: group.version,
  }
}

export function buildSkillRepairPlan(groups: ManagedSkillGroup[], request: SkillRepairPlanRequest): SkillRepairPlan {
  const group = groups.find((item) => item.id === request.skillId)

  if (!group) {
    return {
      id: createPlanId(request),
      kind: request.kind,
      status: "not-found",
      skillId: request.skillId,
      skillName: request.skillId,
      isDestructive: request.kind === "reset",
      requiresConfirmation: false,
      targets: [],
      reason: "Skill is not in the current inventory.",
    }
  }

  if (request.kind === "reset") {
    return buildResetPlan(group, request)
  }

  return buildRestoreSourcePlan(group, request)
}

function buildResetPlan(group: ManagedSkillGroup, request: SkillRepairPlanRequest): SkillRepairPlan {
  const targets = group.hosts
    .filter((host) => !request.agentId || host.agentId === request.agentId)
    .filter((host): host is typeof host & Required<Pick<typeof host, "controlState" | "path" | "sourcePath">> => {
      return (
        host.status === "installed" &&
        host.controlState === "modified" &&
        typeof host.path === "string" &&
        typeof host.sourcePath === "string"
      )
    })
    .map(
      (host): SkillRepairPlanTarget => ({
        agentId: host.agentId,
        agentName: host.agentName,
        controlState: host.controlState,
        currentPath: host.path,
        sourcePath: host.sourcePath,
      }),
    )

  return {
    ...createBasePlan(request, group),
    status: targets.length > 0 ? "ready" : "not-needed",
    isDestructive: true,
    requiresConfirmation: targets.length > 0,
    targets,
    reason:
      targets.length > 0
        ? "Reset will overwrite modified agent copies with the current source."
        : "No modified installed copies need reset.",
  }
}

function buildRestoreSourcePlan(group: ManagedSkillGroup, request: SkillRepairPlanRequest): SkillRepairPlan {
  const targets = group.hosts
    .filter((host) => !request.agentId || host.agentId === request.agentId)
    .filter((host): host is typeof host & Required<Pick<typeof host, "controlState" | "path" | "sourcePath">> => {
      return (
        host.status === "installed" &&
        host.controlState === "source-missing" &&
        typeof host.path === "string" &&
        typeof host.sourcePath === "string"
      )
    })
    .map(
      (host): SkillRepairPlanTarget => ({
        agentId: host.agentId,
        agentName: host.agentName,
        controlState: host.controlState,
        currentPath: host.path,
        sourcePath: host.sourcePath,
      }),
    )

  return {
    ...createBasePlan(request, group),
    status: targets.length > 0 ? "ready" : "not-needed",
    isDestructive: false,
    requiresConfirmation: targets.length > 0,
    targets,
    reason:
      targets.length > 0
        ? "Source restore will recover the canonical source before any agent copy is reset."
        : "No source-missing installed copies need source restore.",
  }
}
