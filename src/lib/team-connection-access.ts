import type { TeamAppAccess } from "../../electron/teams/common.ts"

export const connectorAppRolePrefix = "connector-app:"
const roleSubjectPrefix = "role::"

type JSONPrimitive = boolean | number | string | null
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue }
export type JSONObject = { [key: string]: JSONValue }

export interface ConnectionAccessApp {
  id: string
  service: string
}

export type ConnectionActionAccess = { mode: "unrestricted" } | { mode: "restricted"; actionNames: string[] }

export interface ConnectionPermissionGrant {
  actionAccess: ConnectionActionAccess
  appAccessConfig?: JSONObject
}

export interface ConnectionLingxingAccessUser {
  realname?: string
  uid: string
  username?: string
}

export type ConnectionLingxingUserAccess = { mode: "all" } | { mode: "selected"; users: ConnectionLingxingAccessUser[] }

export interface ConnectionPermissionRule extends ConnectionPermissionGrant {
  id: string
  name: string
}

export interface ConnectionPermissionRules {
  assignments: Record<string, string>
  rules: ConnectionPermissionRule[]
  teamDefault: ConnectionPermissionGrant
}

interface ValidConnectionAppAccess {
  appId: string
  permissionRules: ConnectionPermissionRules
  service: string
}

export type ConnectionAppAccess =
  | ({ mode: "default" } & ValidConnectionAppAccess)
  | ({ mode: "configured" } & ValidConnectionAppAccess)
  | { appId: string; issues: ConnectionAccessIssue[]; mode: "invalid"; service: string | null }

export interface ConnectionAccessIssue {
  appId?: string
  code: "invalid-policy" | "invalid-managed-role" | "missing-app"
  subject?: string
}

export type ConnectionAccessParseResult =
  | { access: TeamAppAccess; apps: ConnectionAppAccess[]; ok: true }
  | { access: TeamAppAccess | null; issues: ConnectionAccessIssue[]; ok: false }

type ParseResult<T> = { ok: true; value: T } | { ok: false }
const invalidParseResult = { ok: false } as const

export function createConnectionPermissionRuleId(): string {
  return globalThis.crypto.randomUUID()
}

export function getConnectionPermissionGrant(
  appAccess: ConnectionAppAccess,
  userId: string,
): ConnectionPermissionGrant | null {
  if (appAccess.mode === "invalid") return null
  const ruleId = appAccess.permissionRules.assignments[userId]
  return appAccess.permissionRules.rules.find((rule) => rule.id === ruleId) ?? appAccess.permissionRules.teamDefault
}

export function getConnectionPermissionRule(
  appAccess: ConnectionAppAccess,
  userId: string,
): ConnectionPermissionRule | null {
  if (appAccess.mode === "invalid") return null
  const ruleId = appAccess.permissionRules.assignments[userId]
  return appAccess.permissionRules.rules.find((rule) => rule.id === ruleId) ?? null
}

export function hasTeamConnectionAppAccess(appAccess: ConnectionAppAccess, userId: string): boolean {
  const grant = getConnectionPermissionGrant(appAccess, userId)
  return grant !== null && (grant.actionAccess.mode === "unrestricted" || grant.actionAccess.actionNames.length > 0)
}

export function getConnectionRuleMemberIds(permissionRules: ConnectionPermissionRules, ruleId: string): string[] {
  return sortedUnique(
    Object.entries(permissionRules.assignments)
      .filter(([, assignedRuleId]) => assignedRuleId === ruleId)
      .map(([userId]) => userId),
  )
}

export function getConnectionLingxingUserAccess(grant: ConnectionPermissionGrant): ConnectionLingxingUserAccess {
  const users = grant.appAccessConfig?.users
  return Array.isArray(users)
    ? { mode: "selected", users: users as unknown as ConnectionLingxingAccessUser[] }
    : { mode: "all" }
}

export function setConnectionLingxingUserAccess(
  grant: ConnectionPermissionGrant,
  access: ConnectionLingxingUserAccess,
): ConnectionPermissionGrant {
  const appAccessConfig = structuredClone(grant.appAccessConfig ?? {})
  const { appAccessConfig: _previousAppAccessConfig, ...grantWithoutAppAccessConfig } = grant
  if (access.mode === "all") delete appAccessConfig.users
  else appAccessConfig.users = normalizeLingxingUsers(access.users) as unknown as JSONValue
  return {
    ...grantWithoutAppAccessConfig,
    ...(Object.keys(appAccessConfig).length > 0 ? { appAccessConfig } : {}),
  }
}

/** Parses only the final permissionRules contract. Historical requireRole/user.roles documents are invalid. */
export function parseTeamConnectionAccess(
  input: unknown,
  availableApps: ConnectionAccessApp[],
  currentMemberIds?: string[],
): ConnectionAccessParseResult {
  if (!isPlainObject(input)) return { access: null, issues: [{ code: "invalid-policy" }], ok: false }

  const access = input as TeamAppAccess
  const appsById = new Map(availableApps.map((app) => [app.id, app]))
  const roleConfigs = new Map<string, unknown>()
  for (const [subject, config] of Object.entries(access)) {
    if (!subject.startsWith(`${roleSubjectPrefix}${connectorAppRolePrefix}`)) continue
    roleConfigs.set(subject.slice(`${roleSubjectPrefix}${connectorAppRolePrefix}`.length), config)
  }

  const memberIdSet = currentMemberIds ? new Set(currentMemberIds) : null
  const appIds = new Set([...appsById.keys(), ...roleConfigs.keys()])
  const apps = Array.from(appIds, (appId): ConnectionAppAccess => {
    const app = appsById.get(appId)
    const config = roleConfigs.get(appId)
    if (!app) return invalidApp(appId, null, "missing-app")
    if (config === undefined) {
      return { appId, mode: "default", permissionRules: unrestrictedPermissionRules(), service: app.service }
    }
    const parsed = parseConfiguredRole(config, app, memberIdSet)
    return parsed.ok
      ? { appId, mode: "configured", permissionRules: parsed.value, service: app.service }
      : invalidApp(appId, app.service, "invalid-managed-role")
  }).sort((left, right) => left.appId.localeCompare(right.appId))

  return { access, apps, ok: true }
}

export function setConnectionPermissionRules(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
): TeamAppAccess {
  const normalized = normalizePermissionRules(permissionRules)
  const next = structuredClone(access)
  const subject = roleSubject(app.id)
  const previous = isPlainObject(next[subject]) ? next[subject] : {}
  next[subject] = {
    ...previous,
    connector: [
      {
        app: [app.id],
        method: "POST",
        permissionRules: {
          assignments: normalized.assignments,
          rules: normalized.rules.map((rule) => ({ id: rule.id, name: rule.name, ...buildGrant(rule) })),
          teamDefault: buildGrant(normalized.teamDefault),
        },
        provider: app.service,
      },
    ],
  }
  return next
}

export function setConnectionTeamDefault(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
  grant: ConnectionPermissionGrant,
): TeamAppAccess {
  return setConnectionPermissionRules(access, app, { ...permissionRules, teamDefault: grant })
}

export function addConnectionPermissionRule(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
  rule: ConnectionPermissionRule,
): TeamAppAccess {
  if (permissionRules.rules.some((item) => item.id === rule.id)) throw new Error(`Duplicate rule ID: ${rule.id}`)
  return setConnectionPermissionRules(access, app, { ...permissionRules, rules: [...permissionRules.rules, rule] })
}

export function updateConnectionPermissionRule(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
  rule: ConnectionPermissionRule,
): TeamAppAccess {
  if (!permissionRules.rules.some((item) => item.id === rule.id)) throw new Error(`Unknown rule ID: ${rule.id}`)
  return setConnectionPermissionRules(access, app, {
    ...permissionRules,
    rules: permissionRules.rules.map((item) => (item.id === rule.id ? rule : item)),
  })
}

export function removeConnectionPermissionRule(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
  ruleId: string,
): TeamAppAccess {
  return setConnectionPermissionRules(access, app, {
    assignments: Object.fromEntries(
      Object.entries(permissionRules.assignments).filter(([, assignedRuleId]) => assignedRuleId !== ruleId),
    ),
    rules: permissionRules.rules.filter((rule) => rule.id !== ruleId),
    teamDefault: permissionRules.teamDefault,
  })
}

export function setConnectionRuleAssignments(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
  ruleId: string,
  userIds: string[],
): TeamAppAccess {
  if (!permissionRules.rules.some((rule) => rule.id === ruleId)) throw new Error(`Unknown rule ID: ${ruleId}`)
  const selected = new Set(userIds)
  const assignments = Object.fromEntries(
    Object.entries(permissionRules.assignments).filter(
      ([userId, assignedRuleId]) => assignedRuleId !== ruleId && !selected.has(userId),
    ),
  )
  for (const userId of sortedUnique(userIds)) assignments[userId] = ruleId
  return setConnectionPermissionRules(access, app, { ...permissionRules, assignments })
}

export function restoreTeamConnectionDefaults(access: TeamAppAccess, appId: string): TeamAppAccess {
  const next = structuredClone(access)
  delete next[roleSubject(appId)]
  return next
}

function parseConfiguredRole(
  input: unknown,
  app: ConnectionAccessApp,
  memberIds: Set<string> | null,
): ParseResult<ConnectionPermissionRules> {
  if (!isPlainObject(input) || !Array.isArray(input.connector) || input.connector.length === 0)
    return invalidParseResult
  const rule = input.connector[0]
  if (!isPlainObject(rule) || rule.method !== "POST" || rule.provider !== app.service) return invalidParseResult
  if (!Object.hasOwn(rule, "permissionRules") || !isPlainObject(rule.permissionRules)) return invalidParseResult
  if (Object.hasOwn(rule, "requireRole") || Object.hasOwn(rule, "actions") || Object.hasOwn(rule, "appAccessConfig")) {
    return invalidParseResult
  }
  return parsePermissionRules(rule.permissionRules, memberIds, app.service)
}

function parsePermissionRules(
  input: Record<string, unknown>,
  memberIds: Set<string> | null,
  service: string,
): ParseResult<ConnectionPermissionRules> {
  if (!Object.hasOwn(input, "teamDefault") || !Object.hasOwn(input, "rules")) return invalidParseResult
  if (Object.keys(input).some((key) => key !== "teamDefault" && key !== "rules" && key !== "assignments")) {
    return invalidParseResult
  }
  const teamDefault = parseGrant(input.teamDefault, service)
  if (!teamDefault.ok || !Array.isArray(input.rules)) return invalidParseResult

  const rules: ConnectionPermissionRule[] = []
  const ruleIds = new Set<string>()
  for (const item of input.rules) {
    if (!isPlainObject(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name)) return invalidParseResult
    if (ruleIds.has(item.id.trim())) return invalidParseResult
    const grant = parseGrant(item, service, new Set(["id", "name"]))
    if (!grant.ok) return invalidParseResult
    const id = item.id.trim()
    ruleIds.add(id)
    rules.push({ id, name: item.name.trim(), ...grant.value })
  }

  const assignments: Record<string, string> = {}
  if (isPlainObject(input.assignments)) {
    for (const [rawUserId, rawRuleId] of Object.entries(input.assignments)) {
      const userId = rawUserId.trim()
      if (!userId || !isNonEmptyString(rawRuleId)) continue
      const ruleId = rawRuleId.trim()
      if (!ruleIds.has(ruleId) || (memberIds && !memberIds.has(userId))) continue
      assignments[userId] = ruleId
    }
  }
  return { ok: true, value: { assignments, rules, teamDefault: teamDefault.value } }
}

function parseGrant(
  input: unknown,
  service: string,
  allowedExtra = new Set<string>(),
): ParseResult<ConnectionPermissionGrant> {
  if (!isPlainObject(input)) return invalidParseResult
  if (Object.keys(input).some((key) => key !== "actions" && key !== "appAccessConfig" && !allowedExtra.has(key))) {
    return invalidParseResult
  }
  const actionAccess = parseActionAccess(input.actions, Object.hasOwn(input, "actions"))
  if (!actionAccess.ok) return invalidParseResult
  if (Object.hasOwn(input, "appAccessConfig") && !isJsonObject(input.appAccessConfig)) return invalidParseResult
  if (service === "lingxing" && isPlainObject(input.appAccessConfig) && !isValidLingxingConfig(input.appAccessConfig)) {
    return invalidParseResult
  }
  return {
    ok: true,
    value: {
      actionAccess: actionAccess.value,
      ...(Object.hasOwn(input, "appAccessConfig")
        ? { appAccessConfig: structuredClone(input.appAccessConfig as JSONObject) }
        : {}),
    },
  }
}

function parseActionAccess(input: unknown, present: boolean): ParseResult<ConnectionActionAccess> {
  if (!present) return { ok: true, value: { mode: "unrestricted" } }
  if (!Array.isArray(input) || input.some((item) => !isNonEmptyString(item) || item.trim() === "*")) {
    return invalidParseResult
  }
  const normalized = input.map((item) => (item as string).trim())
  if (new Set(normalized).size !== normalized.length) return invalidParseResult
  return { ok: true, value: { actionNames: normalized.toSorted(), mode: "restricted" } }
}

function buildGrant(grant: ConnectionPermissionGrant): Record<string, unknown> {
  return {
    ...(grant.actionAccess.mode === "restricted" ? { actions: sortedUnique(grant.actionAccess.actionNames) } : {}),
    ...(grant.appAccessConfig ? { appAccessConfig: structuredClone(grant.appAccessConfig) } : {}),
  }
}

function normalizePermissionRules(permissionRules: ConnectionPermissionRules): ConnectionPermissionRules {
  const rules = permissionRules.rules.map((rule) => ({
    ...structuredClone(rule),
    actionAccess:
      rule.actionAccess.mode === "restricted"
        ? { actionNames: sortedUnique(rule.actionAccess.actionNames), mode: "restricted" as const }
        : rule.actionAccess,
    id: rule.id.trim(),
    name: rule.name.trim(),
  }))
  const ruleIds = new Set(rules.map((rule) => rule.id))
  if (rules.some((rule) => !rule.id || !rule.name) || ruleIds.size !== rules.length) {
    throw new Error("Invalid Connection permission rules")
  }
  const assignments = Object.fromEntries(
    Object.entries(permissionRules.assignments)
      .filter(([userId, ruleId]) => Boolean(userId.trim()) && ruleIds.has(ruleId))
      .map(([userId, ruleId]) => [userId.trim(), ruleId]),
  )
  return { assignments, rules, teamDefault: structuredClone(permissionRules.teamDefault) }
}

function unrestrictedPermissionRules(): ConnectionPermissionRules {
  return { assignments: {}, rules: [], teamDefault: { actionAccess: { mode: "unrestricted" } } }
}

function invalidApp(appId: string, service: string | null, code: ConnectionAccessIssue["code"]): ConnectionAppAccess {
  return { appId, issues: [{ appId, code, subject: roleSubject(appId) }], mode: "invalid", service }
}

function roleSubject(appId: string): string {
  return `${roleSubjectPrefix}${connectorAppRolePrefix}${appId}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonObject(value: unknown): value is JSONObject {
  return isPlainObject(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidLingxingConfig(value: Record<string, unknown>): boolean {
  if (!Object.hasOwn(value, "users")) return true
  if (!Array.isArray(value.users)) return false
  const ids = new Set<string>()
  for (const user of value.users) {
    if (!isPlainObject(user) || !isNonEmptyString(user.uid)) return false
    if (Object.hasOwn(user, "realname") && !isNonEmptyString(user.realname)) return false
    if (Object.hasOwn(user, "username") && !isNonEmptyString(user.username)) return false
    const uid = user.uid.trim()
    if (ids.has(uid)) return false
    ids.add(uid)
  }
  return true
}

function normalizeLingxingUsers(users: ConnectionLingxingAccessUser[]): ConnectionLingxingAccessUser[] {
  const normalized = new Map<string, ConnectionLingxingAccessUser>()
  for (const user of users) {
    const uid = user.uid.trim()
    if (!uid || normalized.has(uid)) continue
    normalized.set(uid, {
      uid,
      ...(user.realname?.trim() ? { realname: user.realname.trim() } : {}),
      ...(user.username?.trim() ? { username: user.username.trim() } : {}),
    })
  }
  return Array.from(normalized.values()).sort((left, right) => left.uid.localeCompare(right.uid))
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort()
}
