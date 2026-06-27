import type { AuthorizationInfo } from "./common.ts"

interface SearchActionResult {
  authenticated?: unknown
  service?: unknown
}

interface SearchAuthorizationContext {
  keywords?: unknown
  query?: unknown
}

function validId(value: string): boolean {
  return value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function normalizedSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function searchContextText(context: SearchAuthorizationContext | undefined): string {
  return [optionalString(context?.keywords), optionalString(context?.query)].filter(Boolean).join(" ")
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
    const contextText = normalizedSearchText(searchContextText(context))
    const matchedServices = contextText
      ? services.filter((service) => contextText.includes(normalizedSearchText(service)))
      : []
    const service = matchedServices.length === 1 ? matchedServices[0] : services.length === 1 ? services[0] : undefined
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
