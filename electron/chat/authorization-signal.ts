import type { AuthorizationInfo } from "./common.ts"

interface SearchActionResult {
  authenticated?: unknown
  authenticatedReliable?: unknown
  service?: unknown
}

interface SearchAuthorizationContext {
  keywords?: unknown
  query?: unknown
  userText?: unknown
}

function validId(value: string): boolean {
  return value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
}

function searchContextText(context: SearchAuthorizationContext | undefined): string {
  return [optionalString(context?.keywords), optionalString(context?.query), optionalString(context?.userText)]
    .filter(Boolean)
    .join(" ")
}

export function parseAuthorizationSignal(output: string | undefined): AuthorizationInfo | null {
  if (!output) {
    return null
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    if (parsed.status !== "authorization_required" || typeof parsed.service !== "string" || !validId(parsed.service)) {
      return null
    }
    return {
      service: parsed.service,
      displayName: optionalString(parsed.displayName) ?? parsed.service,
      action: optionalString(parsed.action),
      authUrl: optionalString(parsed.authUrl),
      errorCode: optionalString(parsed.errorCode),
      message: optionalString(parsed.message),
    }
  } catch {
    return null
  }
}

function displayNameFromService(service: string): string {
  return service
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function serviceTokens(service: string): string[] {
  return searchTokens(service).filter((token) => token !== "oo")
}

function serviceMatchTokens(service: string): Set<string> {
  const tokens = serviceTokens(service)
  const matchTokens = new Set(tokens)
  const compact = tokens.join("")
  if (compact) {
    matchTokens.add(compact)
  }
  return matchTokens
}

function serviceMatchesContext(service: string, contextTokens: Set<string>): boolean {
  const tokens = serviceTokens(service)
  return tokens.length > 0 && tokens.every((token) => contextTokens.has(token))
}

const knownProviderAliasTokens = new Set([
  "airtable",
  "asana",
  "clickup",
  "figma",
  "github",
  "gitlab",
  "gmail",
  "google",
  "googledrive",
  "googlesheets",
  "hubspot",
  "jira",
  "linear",
  "notion",
  "posthog",
  "salesforce",
  "slack",
  "supabase",
  "trello",
  "zendesk",
])

function explicitProviderTokens(value: string): Set<string> {
  const tokens = new Set<string>()
  const matches = value.matchAll(/[A-Za-z0-9][A-Za-z0-9._-]*/g)
  for (const match of matches) {
    const token = match[0] ?? ""
    const normalizedTokens = searchTokens(token)
    const compactToken = normalizedTokens.join("")
    // 品牌名可能是 CamelCase、首字母大写，或常见全小写别名（如 posthog）。
    const looksLikeProviderAlias =
      /[a-z][A-Z]/.test(token) || /^[A-Z][A-Za-z0-9._-]*$/.test(token) || knownProviderAliasTokens.has(compactToken)
    if (!looksLikeProviderAlias) {
      continue
    }
    for (const normalized of normalizedTokens) {
      tokens.add(normalized)
    }
    if (compactToken) {
      tokens.add(compactToken)
    }
  }
  return tokens
}

function hasExplicitProviderMismatch(service: string, contextText: string): boolean {
  const explicitTokens = explicitProviderTokens(contextText)
  if (explicitTokens.size === 0) {
    return false
  }
  return ![...serviceMatchTokens(service)].some((token) => explicitTokens.has(token))
}

export function parseSearchAuthorizationSignal(
  output: string | undefined,
  context?: SearchAuthorizationContext,
): AuthorizationInfo | null {
  if (!output) {
    return null
  }
  try {
    const parsed = JSON.parse(output) as unknown
    if (!Array.isArray(parsed)) {
      return null
    }
    if ((parsed as SearchActionResult[]).some((item) => item?.authenticatedReliable === false)) {
      return null
    }
    const unauthenticatedServices = new Set<string>()
    const authenticatedServices = new Set<string>()
    for (const item of parsed as SearchActionResult[]) {
      if (!item || typeof item !== "object" || typeof item.service !== "string" || !validId(item.service)) {
        continue
      }
      if (item.authenticated === true) {
        authenticatedServices.add(item.service)
        continue
      }
      if (item.authenticated === false) {
        unauthenticatedServices.add(item.service)
      }
    }
    const services = [...unauthenticatedServices].filter((service) => !authenticatedServices.has(service))
    if (services.length === 0) {
      return null
    }
    const contextText = searchContextText(context)
    const contextTokens = new Set(searchTokens(contextText))
    const matchedServices =
      contextTokens.size > 0 ? services.filter((service) => serviceMatchesContext(service, contextTokens)) : []
    const service =
      matchedServices.length === 1
        ? matchedServices[0]
        : services.length === 1 && !hasExplicitProviderMismatch(services[0] ?? "", contextText)
          ? services[0]
          : undefined
    if (!service) {
      return null
    }
    return {
      service,
      displayName: displayNameFromService(service),
      errorCode: "connection_required",
    }
  } catch {
    return null
  }
}
