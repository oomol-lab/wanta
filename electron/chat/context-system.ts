import type { ChatContextMention, ChatOrganizationSkillContext, ChatProjectContext } from "./common.ts"

function quoted(value: string): string {
  return JSON.stringify(value)
}

export function buildContextMentionsSystem(mentions: ChatContextMention[] | undefined): string | undefined {
  if (!mentions || mentions.length === 0) {
    return undefined
  }
  const skills = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "skill" }> => mention.kind === "skill",
  )
  const connections = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "connection" }> => mention.kind === "connection",
  )
  const lines = [
    "User-selected context for this turn:",
    "- Treat these selections as explicit intent hints from the user, not as mandatory tool calls.",
    "- Use them only when they are relevant to the user's actual request.",
  ]
  if (skills.length > 0) {
    lines.push("Selected skills:")
    for (const skill of skills) {
      const detail = skill.description ? `; description: ${quoted(skill.description)}` : ""
      lines.push(`- ${quoted(skill.name)}; id: ${quoted(skill.id)}${detail}`)
    }
    lines.push(
      "The user explicitly selected these skills for this turn. If a selected skill matches the task, load and follow it before acting. If it is clearly unrelated, ignore it and proceed normally. Mention that you used it only when useful to the user.",
    )
  }
  if (connections.length > 0) {
    lines.push("Selected connections:")
    for (const connection of connections) {
      const details = [
        `service: ${quoted(connection.service)}`,
        connection.appId ? `appId: ${quoted(connection.appId)}` : "",
      ].filter(Boolean)
      lines.push(`- ${quoted(connection.displayName)}; ${details.join("; ")}`)
    }
    lines.push(
      "If, after reading the user's request, a Link action is needed, consider the selected connection first. Do not use it for unrelated local files, direct answers, concrete URLs, or general browsing. Still inspect the action schema before calling connector tools.",
    )
  }
  return lines.join("\n")
}

export function buildOrganizationSkillsSystem(skills: ChatOrganizationSkillContext[] | undefined): string | undefined {
  const enabledSkills = (skills ?? []).filter((skill) => skill.id.trim() && skill.name.trim())
  if (enabledSkills.length === 0) {
    return undefined
  }

  const lines = [
    "Organization-configured skills for the active workspace:",
    "- Treat these skills as workspace guidance, not mandatory tool calls.",
    "- Use them only when they are relevant to the user's actual task.",
    "- If the user selected a different explicit context for this turn, prefer the explicit user selection.",
  ]
  for (const skill of enabledSkills) {
    const details = [
      `id: ${quoted(skill.id)}`,
      skill.packageName ? `package: ${quoted(skill.packageName)}` : "",
      skill.version ? `version: ${quoted(skill.version)}` : "",
      skill.description ? `description: ${quoted(skill.description)}` : "",
    ].filter(Boolean)
    lines.push(`- ${quoted(skill.name)}; ${details.join("; ")}`)
  }
  return lines.join("\n")
}

export function buildProjectContextSystem(project: ChatProjectContext | undefined): string | undefined {
  const projectPath = project?.path.trim()
  if (!project || !project.id.trim() || !project.name.trim() || !projectPath) {
    return undefined
  }
  const lines = [
    "Current local project context:",
    `- Project name: ${quoted(project.name)}`,
    `- Project directory: ${quoted(projectPath)}`,
    "- Treat this directory as the active project when the user's request involves code, files, repository state, local analysis, or file organization.",
    "- The shell and file tool cwd may still be Wanta's private scratch workspace; use this project directory as an absolute path instead of assuming cwd.",
    "- Do not mention the full project directory to the user unless they ask for the path or the path is necessary for the task outcome.",
    "- For edits to existing project files, modify files in place under this directory. Use the artifact directory only for exported deliverables, generated assets, converted files, reports, or packaged outputs.",
  ]
  if (project.git?.repositoryRoot) {
    lines.push(`- Git repository root: ${quoted(project.git.repositoryRoot)}`)
    if (project.git.currentBranch) {
      lines.push(`- Current Git branch: ${quoted(project.git.currentBranch)}`)
    } else if (project.git.detachedHead) {
      lines.push(`- Git is in detached HEAD at ${quoted(project.git.detachedHead)}`)
    }
    if (project.git.dirty) {
      lines.push(
        "- The Git worktree has uncommitted changes; inspect status before branch changes or destructive edits.",
      )
    }
  }
  return lines.join("\n")
}

export function mergeSystemPrompts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
  return merged || undefined
}
