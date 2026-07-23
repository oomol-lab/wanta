import type { AppLocale } from "../app-locale.ts"
import type { AgentPermissionMode, ChatContextMention, ChatTeamSkillContext, ChatProjectContext } from "./common.ts"
import type { DetectedResponseLanguage } from "./response-language.ts"

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
  const knowledgeBases = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "knowledge" }> => mention.kind === "knowledge",
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
  if (knowledgeBases.length > 0) {
    lines.push("Knowledge bases pinned to this conversation:")
    for (const knowledgeBase of knowledgeBases) {
      lines.push(`- ${quoted(knowledgeBase.name)}; knowledgeBaseId: ${quoted(knowledgeBase.id)}`)
    }
    lines.push(
      "Use query_knowledge when the user's request depends on these knowledge bases. Prefer entity and triple retrieval for relationship questions, retrieve evidence before presenting factual relationships, and cite chapter/source handles when available. For a requested relationship diagram, choose one specific question, keep the Mermaid graph focused on roughly 5-8 core entities, merge verified aliases, move secondary facts to prose, and use dotted edges for inference or uncertainty. Do not emit style directives or hard-coded colors. Never invoke the WikiGraph CLI directly or expose managed archive paths. Never modify a knowledge base.",
    )
  }
  return lines.join("\n")
}

export function buildTeamSkillsSystem(skills: ChatTeamSkillContext[] | undefined): string | undefined {
  const enabledSkills = (skills ?? []).filter((skill) => skill.id.trim() && skill.name.trim())
  if (enabledSkills.length === 0) {
    return undefined
  }

  const lines = [
    "Team-configured skills for the active workspace:",
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
    "- For project dependency commands, make this directory explicit with `cd <project-directory> && <package-manager> ...` or the package manager's explicit project-directory option. Direct standard-registry packages can be approved automatically regardless of popularity; other project dependency operations can receive a current-task approval. Do not use global installation, a custom registry, a user config, or a Git/URL/local package source unless the user explicitly asks.",
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

export function buildPermissionModeSystem(mode: AgentPermissionMode | undefined): string {
  if (mode === "full_access") {
    return [
      "Permission mode for this turn: Full Access (session-scoped local YOLO).",
      "- The user has enabled Full Access for this session; treat it as YOLO for local tools.",
      "- You may use local shell commands, edit files, and access external filesystem paths when needed for the task.",
      "- Local permission requests are auto-approved in this mode, including shell commands, file reads/writes/deletes, and external paths.",
      "- Do not ask the user to switch modes or approve local tool calls in this chat.",
      "- Still ask for confirmation when a non-local business workflow explicitly requires user approval.",
    ].join("\n")
  }
  return [
    "Permission mode for this turn: Default Access.",
    "- Prefer the simplest reliable path across direct answers, local shell/files, Wanta Link tools, Wanta-controlled app APIs, concrete URL fetching, and selected local context.",
    "- Use bash normally when it is useful for the task. Ordinary shell commands, scripts, project checks, data processing, and simple output filtering are expected to run without user-visible approval.",
    "- Concrete non-sensitive files, ordinary bounded directories, and shallow directory listings may also be approved automatically by Wanta, including paths outside the selected project when the task calls for them.",
    "- Wanta may pause only for basic safety boundaries such as credential/secret paths, broad home/system scans, private browser or Mail/Messages/Contacts/Calendars data, destructive deletion, global/system dependency changes, alternate package sources, explicitly high-cost runtimes, privilege escalation, git push/reset/clean, publishing/deployment, or infrastructure mutations. Direct PyPI requirements in the task-private environment and direct standard-registry Node.js packages explicitly scoped to the task directory or current project are approved automatically regardless of package popularity. Package runners are ordinary local execution. Other project dependency operations may be approved once for the current task.",
    "- Do not ask the user to approve ordinary local tool calls or switch modes. If Wanta pauses for a protected operation, ask only for that specific operation.",
  ].join("\n")
}

export function buildResponseLanguageSystem(
  appLocale: AppLocale | undefined,
  detectedLanguage?: DetectedResponseLanguage,
): string {
  const fallback =
    appLocale === "en"
      ? "- If neither the latest request nor the conversation establishes a language, use the application interface language: English."
      : appLocale === "zh-CN"
        ? "- If neither the latest request nor the conversation establishes a language, use the application interface language: Simplified Chinese."
        : "- If neither the latest request nor the conversation establishes a language, use the language that best fits the user's available context."
  const detection = detectedLanguage
    ? `- Wanta has classified the latest user instruction as ${detectedLanguage}. Respond in ${detectedLanguage} unless the user explicitly requests a different response language. This classification takes priority over the application interface language. When delegating work through the task tool, explicitly require ${detectedLanguage} in the task prompt. Never present a subagent result in a different language; translate or rewrite it into ${detectedLanguage} before showing it to the user.`
    : "- Wanta could not classify the latest instruction with high confidence. Infer its language from the instruction itself and the rules below."
  return [
    "Response language policy for this turn:",
    detection,
    "- Use the primary language of the user's latest substantive request for every user-facing assistant message, including progress updates, tool-call commentary, structured questions, confirmations, error explanations, and the final response, unless the user explicitly assigns a different language to a specific scope.",
    "- Explicit language requests always override detected or fallback language within their stated scope: an explanation language governs explanations and related progress, a deliverable language governs only the deliverable, and any other user-facing content continues in the latest-request language unless the user says otherwise. For example, if the user asks for an English explanation and a Chinese deliverable, explain in English and produce only the deliverable in Chinese.",
    "- Determine the response language from the user's instruction, not from quoted material, source documents, attachments, tool output, skill content, code, identifiers, file paths, or an earlier turn when the latest request has a clear language.",
    "- If the latest request is language-neutral or too short to determine, continue the established conversation language.",
    fallback,
  ].join("\n")
}

export function mergeSystemPrompts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
  return merged || undefined
}
