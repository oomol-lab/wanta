import type { TeamAppAccess } from "../../electron/teams/common.ts"

export const connectorAppRolePrefix = "connector-app:"

const roleSubjectPrefix = "role::"
const userSubjectPrefix = "user::"

export type ConnectionAccessApp = {
  id: string
  service: string
}

export type ConnectionActionAccess = { mode: "unrestricted" } | { mode: "restricted"; actionNames: string[] }

export type ConnectionMemberAccess = { mode: "team" } | { mode: "selected"; userIds: string[] }

export type ConnectionAppAccess =
  | {
      actionAccess: { mode: "unrestricted" }
      appId: string
      memberAccess: { mode: "team" }
      mode: "default"
      service: string
    }
  | {
      actionAccess: ConnectionActionAccess
      appId: string
      memberAccess: ConnectionMemberAccess
      mode: "configured"
      service: string
    }
  | {
      appId: string
      issues: ConnectionAccessIssue[]
      mode: "invalid"
      service: string | null
    }

export type ConnectionAccessIssue = {
  appId?: string
  code: "invalid-policy" | "invalid-managed-role" | "missing-app"
  subject?: string
}

export type ConnectionAccessParseResult =
  | { access: TeamAppAccess; apps: ConnectionAppAccess[]; ok: true }
  | { access: TeamAppAccess | null; issues: ConnectionAccessIssue[]; ok: false }

/**
 * Parses the current connector contract. A malformed rule is scoped to its App and never becomes
 * a broader Team grant. Historical user.connector rules are intentionally ignored.
 */
export function parseTeamConnectionAccess(
  input: unknown,
  availableApps: ConnectionAccessApp[],
): ConnectionAccessParseResult {
  if (!isPlainObject(input)) return { access: null, issues: [{ code: "invalid-policy" }], ok: false }

  const access = input as TeamAppAccess
  const appsById = new Map(availableApps.map((app) => [app.id, app]))
  const roleConfigs = new Map<string, unknown>()
  const userIdsByApp = new Map<string, Set<string>>()

  for (const [subject, config] of Object.entries(access)) {
    if (subject.startsWith(`${roleSubjectPrefix}${connectorAppRolePrefix}`)) {
      roleConfigs.set(subject.slice(`${roleSubjectPrefix}${connectorAppRolePrefix}`.length), config)
      continue
    }
    if (!subject.startsWith(userSubjectPrefix) || !isPlainObject(config) || config.roles === undefined) continue
    if (!isStringArray(config.roles)) {
      return { access, issues: [{ code: "invalid-policy", subject }], ok: false }
    }
    const userId = subject.slice(userSubjectPrefix.length)
    for (const role of config.roles) {
      if (!role.startsWith(connectorAppRolePrefix)) continue
      const appId = role.slice(connectorAppRolePrefix.length)
      const userIds = userIdsByApp.get(appId) ?? new Set<string>()
      userIds.add(userId)
      userIdsByApp.set(appId, userIds)
    }
  }

  const appIds = new Set([...appsById.keys(), ...roleConfigs.keys(), ...userIdsByApp.keys()])
  const apps = Array.from(appIds, (appId): ConnectionAppAccess => {
    const app = appsById.get(appId)
    const roleConfig = roleConfigs.get(appId)
    if (!app) {
      return {
        appId,
        issues: [{ appId, code: "missing-app", subject: roleSubject(appId) }],
        mode: "invalid",
        service: null,
      }
    }
    if (roleConfig === undefined) {
      return {
        actionAccess: { mode: "unrestricted" },
        appId,
        memberAccess: { mode: "team" },
        mode: "default",
        service: app.service,
      }
    }
    const rule = parseRoleRule(roleConfig, app, sortedUnique(Array.from(userIdsByApp.get(appId) ?? [])))
    if (!rule) {
      return {
        appId,
        issues: [{ appId, code: "invalid-managed-role", subject: roleSubject(appId) }],
        mode: "invalid",
        service: app.service,
      }
    }
    return { appId, mode: "configured", service: app.service, ...rule }
  }).sort((left, right) => left.appId.localeCompare(right.appId))

  return { access, apps, ok: true }
}

export function setTeamConnectionMemberAccess(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  memberAccess: ConnectionMemberAccess,
): TeamAppAccess {
  const next = structuredClone(access)
  removeLegacyUserConnectorRules(next)
  const existing = accessForWrite(next, app)
  if (memberAccess.mode === "selected" || Object.hasOwn(next, roleSubject(app.id))) {
    writeRole(next, app, memberAccess, existing.actionAccess)
  }
  writeAppUsers(next, app.id, memberAccess.mode === "selected" ? memberAccess.userIds : [])
  return next
}

export function setTeamConnectionActionAccess(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  actionAccess: ConnectionActionAccess,
): TeamAppAccess {
  const next = structuredClone(access)
  removeLegacyUserConnectorRules(next)
  if (actionAccess.mode === "unrestricted" && !Object.hasOwn(next, roleSubject(app.id))) return next
  const existing = accessForWrite(next, app)
  writeRole(next, app, existing.memberAccess, actionAccess)
  return next
}

export function restoreTeamConnectionDefaults(access: TeamAppAccess, appId: string): TeamAppAccess {
  const next = structuredClone(access)
  removeLegacyUserConnectorRules(next)
  delete next[roleSubject(appId)]
  writeAppUsers(next, appId, [])
  return next
}

function accessForWrite(access: TeamAppAccess, app: ConnectionAccessApp) {
  const existing = access[roleSubject(app.id)]
  if (existing === undefined) {
    return { actionAccess: { mode: "unrestricted" } as const, memberAccess: { mode: "team" } as const }
  }
  const parsed = parseRoleRule(existing, app, [])
  if (!parsed) throw new Error(`Invalid Connector App role: ${app.id}`)
  return parsed
}

function parseRoleRule(
  config: unknown,
  app: ConnectionAccessApp,
  userIds: string[],
): { actionAccess: ConnectionActionAccess; memberAccess: ConnectionMemberAccess } | null {
  if (!isPlainObject(config) || !Array.isArray(config.connector)) return null
  const scopedRules = config.connector.filter(hasAppScope)
  const rules = scopedRules.length > 0 ? scopedRules : config.connector
  if (rules.length !== 1 || !isPlainObject(rules[0])) return null
  const rule = rules[0]
  if (rule.method !== "POST" || rule.provider !== app.service) return null
  if (rule.requireRole !== undefined && typeof rule.requireRole !== "boolean") return null
  const memberAccess: ConnectionMemberAccess =
    rule.requireRole === true ? { mode: "selected", userIds } : { mode: "team" }
  if (!Object.hasOwn(rule, "actions")) return { actionAccess: { mode: "unrestricted" }, memberAccess }
  if (!isStringArray(rule.actions) || rule.actions.includes("*")) return null
  return { actionAccess: { actionNames: sortedUnique(rule.actions), mode: "restricted" }, memberAccess }
}

function writeRole(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  memberAccess: ConnectionMemberAccess,
  actionAccess: ConnectionActionAccess,
): void {
  const subject = roleSubject(app.id)
  const previous = isPlainObject(access[subject]) ? access[subject] : {}
  access[subject] = {
    ...previous,
    connector: [
      {
        app: [app.id],
        method: "POST",
        provider: app.service,
        requireRole: memberAccess.mode === "selected",
        ...(actionAccess.mode === "restricted" ? { actions: sortedUnique(actionAccess.actionNames) } : {}),
      },
    ],
  }
}

function writeAppUsers(access: TeamAppAccess, appId: string, userIds: string[]): void {
  const role = `${connectorAppRolePrefix}${appId}`
  const selected = new Set(userIds)
  const subjects = new Set(Object.keys(access).filter((subject) => subject.startsWith(userSubjectPrefix)))
  for (const userId of selected) subjects.add(`${userSubjectPrefix}${userId}`)
  for (const subject of subjects) {
    const config = isPlainObject(access[subject]) ? access[subject] : {}
    const roles = isStringArray(config.roles) ? config.roles : []
    const nextRoles = selected.has(subject.slice(userSubjectPrefix.length))
      ? sortedUnique([...roles, role])
      : roles.filter((value) => value !== role)
    const { connector: _connector, roles: _roles, ...rest } = config
    const next = { ...rest, ...(nextRoles.length > 0 ? { roles: nextRoles } : {}) }
    if (Object.keys(next).length > 0) access[subject] = next
    else delete access[subject]
  }
}

function removeLegacyUserConnectorRules(access: TeamAppAccess): void {
  for (const [subject, config] of Object.entries(access)) {
    if (!subject.startsWith(userSubjectPrefix) || !isPlainObject(config) || !Object.hasOwn(config, "connector")) continue
    const { connector: _connector, ...rest } = config
    if (Object.keys(rest).length > 0) access[subject] = rest
    else delete access[subject]
  }
}

function roleSubject(appId: string): string {
  return `${roleSubjectPrefix}${connectorAppRolePrefix}${appId}`
}

function hasAppScope(value: unknown): boolean {
  return isPlainObject(value) && Object.hasOwn(value, "app")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}
