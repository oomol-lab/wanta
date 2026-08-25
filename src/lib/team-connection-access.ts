import type { TeamAppAccess } from "../../electron/teams/common.ts"

export const connectorAppRolePrefix = "connector-app:"
const roleSubjectPrefix = "role::"
const userSubjectPrefix = "user::"

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
  | ({ format: "legacy" | "multi"; mode: "configured" } & ValidConnectionAppAccess)
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

/** Reads legacy and multi-rule policies; every writer emits the canonical multi-rule contract. */
export function parseTeamConnectionAccess(
  input: unknown,
  availableApps: ConnectionAccessApp[],
  currentMemberIds?: string[],
  legacyRuleName = "Rule #1",
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
    const parsed = parseConfiguredRole(access, config, app, memberIdSet, legacyRuleName)
    return parsed.ok
      ? {
          appId,
          format: parsed.value.format,
          mode: "configured",
          permissionRules: parsed.value.permissionRules,
          service: app.service,
        }
      : invalidApp(appId, app.service, "invalid-managed-role")
  }).sort((left, right) => left.appId.localeCompare(right.appId))

  return { access, apps, ok: true }
}

export function setConnectionPermissionRules(
  access: TeamAppAccess,
  app: ConnectionAccessApp,
  permissionRules: ConnectionPermissionRules,
): TeamAppAccess {
  const normalized = normalizePermissionRules(permissionRules, app.service, `legacy:${app.id}`)
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
  removeLegacyAppRoleReferences(next, app.id)
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
  removeLegacyAppRoleReferences(next, appId)
  return next
}

function parseConfiguredRole(
  access: TeamAppAccess,
  input: unknown,
  app: ConnectionAccessApp,
  memberIds: Set<string> | null,
  legacyRuleName: string,
): ParseResult<{ format: "legacy" | "multi"; permissionRules: ConnectionPermissionRules }> {
  if (!isPlainObject(input) || !Array.isArray(input.connector) || input.connector.length === 0)
    return invalidParseResult
  const rule = input.connector[0]
  if (!isPlainObject(rule) || Object.hasOwn(rule, "effect")) return invalidParseResult
  if (Object.hasOwn(rule, "permissionRules")) {
    const parsed = parsePermissionRules(rule, memberIds, app)
    return parsed.ok ? { ok: true, value: { format: "multi", permissionRules: parsed.value } } : invalidParseResult
  }
  const parsed = parseLegacyRule(access, rule, app, memberIds, legacyRuleName)
  return parsed.ok ? { ok: true, value: { format: "legacy", permissionRules: parsed.value } } : invalidParseResult
}

function parsePermissionRules(
  rule: Record<string, unknown>,
  memberIds: Set<string> | null,
  app: ConnectionAccessApp,
): ParseResult<ConnectionPermissionRules> {
  if (
    !hasOnlyKeys(rule, ["app", "method", "provider", "permissionRules"]) ||
    rule.method !== "POST" ||
    rule.provider !== app.service ||
    !isPlainObject(rule.permissionRules) ||
    !hasOnlyKeys(rule.permissionRules, ["teamDefault", "rules", "assignments"]) ||
    !Object.hasOwn(rule.permissionRules, "teamDefault") ||
    !Array.isArray(rule.permissionRules.rules)
  ) {
    return invalidParseResult
  }
  const permissionRules = rule.permissionRules
  const teamDefault = parseGrant(permissionRules.teamDefault, app.service, "multi")
  if (!teamDefault.ok) return invalidParseResult
  const permissionRuleValues = permissionRules.rules as unknown[]

  const rules: ConnectionPermissionRule[] = []
  const ruleIds = new Set<string>()
  for (const item of permissionRuleValues) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ["id", "name", "actions", "appAccessConfig"])) {
      return invalidParseResult
    }
    if (!isNonEmptyString(item.id) || !isNonEmptyString(item.name) || ruleIds.has(item.id)) {
      return invalidParseResult
    }
    const grant = parseGrant(item, app.service, "multi", ["id", "name"])
    if (!grant.ok) return invalidParseResult
    ruleIds.add(item.id)
    rules.push({ id: item.id, name: item.name, ...grant.value })
  }

  const assignments: Record<string, string> = {}
  if (isPlainObject(permissionRules.assignments)) {
    for (const [userId, ruleId] of Object.entries(permissionRules.assignments)) {
      if (!isNonEmptyString(userId) || !isNonEmptyString(ruleId)) continue
      if (memberIds && !memberIds.has(userId)) continue
      if (!ruleIds.has(ruleId)) continue
      assignments[userId] = ruleId
    }
  }
  return { ok: true, value: { assignments, rules, teamDefault: teamDefault.value } }
}

function parseLegacyRule(
  access: TeamAppAccess,
  rule: Record<string, unknown>,
  app: ConnectionAccessApp,
  memberIds: Set<string> | null,
  legacyRuleName: string,
): ParseResult<ConnectionPermissionRules> {
  if (
    !legacyFieldIncludes(rule.method, "POST") ||
    !legacyFieldIncludes(rule.provider, app.service) ||
    (Object.hasOwn(rule, "requireRole") && typeof rule.requireRole !== "boolean")
  ) {
    return invalidParseResult
  }
  const grant = parseGrant(rule, app.service, "legacy")
  if (!grant.ok) return invalidParseResult
  if (rule.requireRole !== true) return { ok: true, value: { assignments: {}, rules: [], teamDefault: grant.value } }

  const legacyRuleId = `legacy:${app.id}`
  const roleName = `${connectorAppRolePrefix}${app.id}`
  const assignments: Record<string, string> = {}
  for (const [subject, value] of Object.entries(access)) {
    if (!subject.startsWith(userSubjectPrefix) || !isPlainObject(value) || !Array.isArray(value.roles)) continue
    const userId = subject.slice(userSubjectPrefix.length)
    if (!userId || (memberIds && !memberIds.has(userId))) continue
    if (value.roles.some((item) => isNonEmptyString(item) && item === roleName)) assignments[userId] = legacyRuleId
  }
  return {
    ok: true,
    value: {
      assignments,
      rules: [{ id: legacyRuleId, name: legacyRuleName, ...grant.value }],
      teamDefault: { actionAccess: { actionNames: [], mode: "restricted" } },
    },
  }
}

function parseGrant(
  input: unknown,
  service: string,
  format: "legacy" | "multi",
  extraKeys: string[] = [],
): ParseResult<ConnectionPermissionGrant> {
  if (!isPlainObject(input)) return invalidParseResult
  if (format === "multi" && !hasOnlyKeys(input, [...extraKeys, "actions", "appAccessConfig"])) {
    return invalidParseResult
  }
  const actionAccess = parseActionAccess(input.actions, Object.hasOwn(input, "actions"), format)
  if (!actionAccess.ok) return invalidParseResult
  let appAccessConfig: JSONObject | undefined
  if (Object.hasOwn(input, "appAccessConfig")) {
    const parsed = parseAppAccessConfig(input.appAccessConfig, service, format)
    if (!parsed.ok) return invalidParseResult
    appAccessConfig = parsed.value
  }
  return {
    ok: true,
    value: {
      actionAccess: actionAccess.value,
      ...(appAccessConfig === undefined ? {} : { appAccessConfig }),
    },
  }
}

function parseActionAccess(
  input: unknown,
  present: boolean,
  format: "legacy" | "multi",
): ParseResult<ConnectionActionAccess> {
  if (!present) return { ok: true, value: { mode: "unrestricted" } }
  if (!Array.isArray(input) || input.some((item) => !isNonEmptyString(item) || item.trim() === "*")) {
    return invalidParseResult
  }
  const normalized = input.map((item) => (item as string).trim())
  if (format === "multi" && new Set(normalized).size !== normalized.length) return invalidParseResult
  return { ok: true, value: { actionNames: sortedUnique(normalized), mode: "restricted" } }
}

function parseAppAccessConfig(input: unknown, service: string, format: "legacy" | "multi"): ParseResult<JSONObject> {
  if (service !== "lingxing" || !isPlainObject(input) || !isJsonObject(input)) return invalidParseResult
  if (!Object.hasOwn(input, "users")) return { ok: true, value: input }
  if (!Array.isArray(input.users)) return format === "legacy" ? { ok: true, value: input } : invalidParseResult
  const users: JSONObject[] = []
  const userIds = new Set<string>()
  for (const value of input.users) {
    if (format === "legacy") {
      if (!isPlainObject(value) || !isJsonObject(value)) continue
      const uid = normalizeLegacyLingxingUid(value.uid)
      if (!uid || userIds.has(uid)) continue
      userIds.add(uid)
      users.push({ ...value, uid })
      continue
    }
    if (
      !isPlainObject(value) ||
      !hasOnlyKeys(value, ["uid", "realname", "username"]) ||
      !isNonEmptyString(value.uid) ||
      (value.realname !== undefined && !isNonEmptyString(value.realname)) ||
      (value.username !== undefined && !isNonEmptyString(value.username))
    ) {
      return invalidParseResult
    }
    const uid = value.uid.trim()
    if (userIds.has(uid)) return invalidParseResult
    userIds.add(uid)
    users.push({
      uid,
      ...(value.realname === undefined ? {} : { realname: value.realname.trim() }),
      ...(value.username === undefined ? {} : { username: value.username.trim() }),
    })
  }
  return { ok: true, value: { ...input, users } }
}

function buildGrant(grant: ConnectionPermissionGrant): Record<string, unknown> {
  return {
    ...(grant.actionAccess.mode === "restricted" ? { actions: sortedUnique(grant.actionAccess.actionNames) } : {}),
    ...(grant.appAccessConfig ? { appAccessConfig: structuredClone(grant.appAccessConfig) } : {}),
  }
}

function normalizePermissionRules(
  permissionRules: ConnectionPermissionRules,
  service: string,
  legacyRuleId: string,
): ConnectionPermissionRules {
  const ruleIds = new Set<string>()
  const normalizedRuleIds = new Map<string, string>()
  const rules = permissionRules.rules.map((rule) => {
    const sourceId = rule.id.trim()
    const id = sourceId === legacyRuleId ? createConnectionPermissionRuleId() : sourceId
    const name = rule.name.trim()
    if (!id || !name || ruleIds.has(id)) throw new Error("Invalid Connection permission rules")
    ruleIds.add(id)
    normalizedRuleIds.set(sourceId, id)
    return { id, name, ...normalizeGrantForWrite(rule, service) }
  })
  const assignments = Object.fromEntries(
    Object.entries(permissionRules.assignments)
      .flatMap(([userId, ruleId]) => {
        const normalizedRuleId = normalizedRuleIds.get(ruleId)
        return userId.trim() && normalizedRuleId ? [[userId, normalizedRuleId] as const] : []
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  return { assignments, rules, teamDefault: normalizeGrantForWrite(permissionRules.teamDefault, service) }
}

function normalizeGrantForWrite(grant: ConnectionPermissionGrant, service: string): ConnectionPermissionGrant {
  if (service !== "lingxing" && grant.appAccessConfig !== undefined) {
    throw new Error(`App access config is not supported for ${service}`)
  }
  let appAccessConfig = grant.appAccessConfig === undefined ? undefined : structuredClone(grant.appAccessConfig)
  if (service === "lingxing" && appAccessConfig !== undefined) {
    const parsed = parseAppAccessConfig(appAccessConfig, service, "multi")
    if (!parsed.ok) throw new Error("Invalid Lingxing App access config")
    appAccessConfig = parsed.value
  }
  return {
    actionAccess:
      grant.actionAccess.mode === "restricted"
        ? { actionNames: sortedUnique(grant.actionAccess.actionNames), mode: "restricted" }
        : { mode: "unrestricted" },
    ...(appAccessConfig === undefined ? {} : { appAccessConfig }),
  }
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

function removeLegacyAppRoleReferences(access: TeamAppAccess, appId: string): void {
  const roleName = `${connectorAppRolePrefix}${appId}`
  for (const [subject, value] of Object.entries(access)) {
    if (!subject.startsWith(userSubjectPrefix) || !isPlainObject(value)) continue
    const { roles: _roles, ...rest } = value
    const roles = Array.isArray(value.roles)
      ? value.roles.filter((role) => typeof role !== "string" || role !== roleName)
      : value.roles
    const nextValue: Record<string, unknown> = { ...rest }
    if (Array.isArray(roles) ? roles.length > 0 : roles !== undefined) nextValue.roles = roles
    if (Object.keys(nextValue).length > 0) access[subject] = nextValue
    else delete access[subject]
  }
}

function legacyFieldIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected
}

function normalizeLegacyLingxingUid(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim()
    return normalized && normalized !== "0" ? normalized : undefined
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value !== 0 ? String(value) : undefined
}

function hasOnlyKeys(input: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(input).every((key) => allowed.has(key))
}
