import type { OrganizationAppAccess } from "../../../electron/organizations/common.ts"

export type ProviderGrant = {
  allProviders: boolean
  providers: string[]
  userId: string
}

export type AppAccessParseResult =
  | { access: OrganizationAppAccess; grants: ProviderGrant[]; ok: true }
  | { error: Error; ok: false }

const subjectPrefix = "user::"

export function parseProviderGrants(input: unknown): AppAccessParseResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: new Error("App access must be an object.") }
  }

  const access = input as OrganizationAppAccess
  const grants: ProviderGrant[] = []

  for (const [subject, services] of Object.entries(access)) {
    if (!subject.startsWith(subjectPrefix) || !isPlainObject(services)) {
      continue
    }

    const connector = services["connector"]
    if (!Array.isArray(connector)) {
      continue
    }

    const providers = new Set<string>()
    let allProviders = false

    for (const rule of connector) {
      if (!isProviderAccessRule(rule)) {
        continue
      }

      const ruleProviders = rule.provider
      if (ruleProviders === "*") {
        allProviders = true
        continue
      }

      if (Array.isArray(ruleProviders)) {
        for (const provider of ruleProviders) {
          if (typeof provider === "string" && provider !== "*") {
            providers.add(provider)
          }
        }
        continue
      }

      providers.add(ruleProviders)
    }

    if (allProviders || providers.size > 0) {
      grants.push({
        allProviders,
        providers: allProviders ? [] : Array.from(providers).sort(),
        userId: subject.slice(subjectPrefix.length),
      })
    }
  }

  return {
    access,
    grants: grants.sort((left, right) => left.userId.localeCompare(right.userId)),
    ok: true,
  }
}

export function setProviderGrant(
  access: OrganizationAppAccess,
  userId: string,
  providers: string[],
  allProviders: boolean,
): OrganizationAppAccess {
  const next = cloneAppAccess(access)
  const subject = userSubject(userId)
  const services = next[subject] ?? {}
  const connector = Array.isArray(services["connector"])
    ? services["connector"].filter((rule) => !isProviderAccessRule(rule))
    : []

  connector.push(
    allProviders
      ? { actions: ["*"], method: "POST", provider: "*" }
      : { method: "POST", provider: uniqueSorted(providers) },
  )

  next[subject] = {
    ...services,
    connector,
  }
  return next
}

export function removeProviderGrant(access: OrganizationAppAccess, userId: string): OrganizationAppAccess {
  const next = cloneAppAccess(access)
  const subject = userSubject(userId)
  const services = next[subject]
  if (!services) {
    return next
  }

  const connector = Array.isArray(services["connector"])
    ? services["connector"].filter((rule) => !isProviderAccessRule(rule))
    : []
  if (connector.length > 0) {
    next[subject] = {
      ...services,
      connector,
    }
    return next
  }

  const { connector: _connector, ...rest } = services
  if (Object.keys(rest).length > 0) {
    next[subject] = rest
  } else {
    delete next[subject]
  }
  return next
}

function isProviderAccessRule(input: unknown): input is Record<string, unknown> & { provider: string | string[] } {
  if (!isPlainObject(input)) {
    return false
  }
  if (!isAllowEffect(input["effect"])) {
    return false
  }
  if (!allowsPostMethod(input["method"])) {
    return false
  }
  if (Object.hasOwn(input, "parameters") || Object.hasOwn(input, "attributes")) {
    return false
  }

  const provider = input["provider"]
  const actions = input["actions"]

  if (typeof provider === "string") {
    return actions === undefined || containsWildcard(actions)
  }

  return Array.isArray(provider) && provider.every((item) => typeof item === "string") && actions === undefined
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false
  }
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function isAllowEffect(effect: unknown): boolean {
  return effect === undefined || effect === "allow"
}

function allowsPostMethod(method: unknown): boolean {
  if (method === undefined || method === "POST" || method === "*") {
    return true
  }
  return Array.isArray(method) && method.some((item) => item === "POST" || item === "*")
}

function containsWildcard(value: unknown): boolean {
  return value === "*" || (Array.isArray(value) && value.some((item) => item === "*"))
}

function cloneAppAccess(access: OrganizationAppAccess): OrganizationAppAccess {
  return structuredClone(access)
}

function userSubject(userId: string): string {
  return `${subjectPrefix}${userId}`
}

function uniqueSorted(providers: string[]): string[] {
  return Array.from(new Set(providers)).sort()
}
