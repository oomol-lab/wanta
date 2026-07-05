import type { ManagedSkillGroup } from "./common.ts"

import path from "node:path"
import { readDeletableSkillTargetPaths } from "./file-operations.ts"

export type SkillDeleteTargetKind = "agent-host" | "global-registry-source" | "wanta-registry-source"
export type SkillDeleteStoreKind = "global" | "wanta"

export interface SkillDeleteTarget {
  kind: SkillDeleteTargetKind
  path: string
}

export interface SkillDeleteStoreTarget {
  kind: SkillDeleteStoreKind
  packageName?: string
  skillId: string
}

export interface SkillDeletePlan {
  packageName?: string
  skillId: string
  storeTargets: SkillDeleteStoreTarget[]
  targets: SkillDeleteTarget[]
}

export interface BuildSkillDeletePlanRequest {
  agentSkillRoots: string[]
  globalRegistrySkillRoot: string
  group: ManagedSkillGroup
  wantaRegistrySkillRoot: string
}

export function buildLocalMachineSkillDeletePlan({
  agentSkillRoots,
  globalRegistrySkillRoot,
  group,
  wantaRegistrySkillRoot,
}: BuildSkillDeletePlanRequest): SkillDeletePlan {
  const skillId = group.id
  const packageName = group.packageName?.trim() || undefined
  const targets = new Map<string, SkillDeleteTarget>()

  for (const targetPath of readDeletableSkillTargetPaths(group, agentSkillRoots)) {
    targets.set(path.resolve(targetPath), {
      kind: "agent-host",
      path: targetPath,
    })
  }

  const storeTargets: SkillDeleteStoreTarget[] = []
  if (group.kind === "registry") {
    storeTargets.push(
      {
        kind: "wanta",
        packageName,
        skillId,
      },
      {
        kind: "global",
        packageName,
        skillId,
      },
    )

    for (const target of [
      {
        kind: "wanta-registry-source" as const,
        path: path.join(wantaRegistrySkillRoot, skillId),
      },
      {
        kind: "global-registry-source" as const,
        path: path.join(globalRegistrySkillRoot, skillId),
      },
      ...group.hosts.flatMap((host): SkillDeleteTarget[] =>
        host.sourcePath
          ? [
              {
                kind: path.resolve(host.sourcePath).startsWith(path.resolve(globalRegistrySkillRoot) + path.sep)
                  ? "global-registry-source"
                  : "wanta-registry-source",
                path: host.sourcePath,
              },
            ]
          : [],
      ),
    ]) {
      targets.set(path.resolve(target.path), target)
    }
  }

  return {
    packageName,
    skillId,
    storeTargets,
    targets: Array.from(targets.values()),
  }
}
