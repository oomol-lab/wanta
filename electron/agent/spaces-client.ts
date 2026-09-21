import { z } from "zod"
import { spacesBaseUrl } from "../domain.ts"

export const spaceSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["creating", "live", "suspended", "failed", "deleting"]),
  visibility: z.enum(["team", "public"]),
  building: z.boolean().optional(),
  url: z.url(),
  convexDeploymentUrl: z.url().nullable(),
  nextChargeAt: z.number().nullable().optional(),
  graceUntil: z.number().nullable().optional(),
})
export type Space = z.infer<typeof spaceSchema>
export const spaceJobSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  version: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
})
export type SpaceJob = z.infer<typeof spaceJobSchema>

export interface SpacesIdentity {
  accountId: string
  token: string
  teamName: string
}

export class SpacesApiError extends Error {
  public readonly code: string
  public readonly status: number
  public constructor(code: string, status: number) {
    super(`Spaces: ${code} (HTTP ${status}).`)
    this.code = code
    this.status = status
  }
}

/** No raw URLs, credentials or backend keys are accepted from the model. */
export class SpacesClient {
  private readonly identity: SpacesIdentity
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  public constructor(identity: SpacesIdentity, fetcher: typeof fetch = fetch, baseUrl = spacesBaseUrl) {
    this.identity = identity
    this.fetcher = fetcher
    this.baseUrl = baseUrl
  }

  public async request<T>(
    method: "GET" | "POST",
    pathname: string,
    schema: z.ZodType<T>,
    options: { json?: unknown; bytes?: Buffer; key?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!this.identity.token || !this.identity.teamName.trim())
      throw new Error("Spaces requires an OOMOL account and an explicit team.")
    if (!pathname.startsWith("/v1/spaces") || pathname.includes("..")) throw new Error("Invalid Spaces endpoint.")
    if (method === "POST" && !options.key) throw new Error("Spaces writes require an idempotency key.")
    const headers: Record<string, string> = {
      authorization: this.identity.token,
      "x-oo-team-name": this.identity.teamName,
      accept: "application/json",
    }
    if (options.key) headers["Idempotency-Key"] = options.key
    if (options.json !== undefined) headers["Content-Type"] = "application/json"
    if (options.bytes) {
      headers["Content-Type"] = "application/zip"
      headers["Content-Length"] = String(options.bytes.length)
    }
    const timeout = AbortSignal.timeout(options.bytes ? 10 * 60_000 : 60_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        redirect: "error",
        signal,
        body: options.bytes
          ? new Uint8Array(options.bytes)
          : options.json !== undefined
            ? JSON.stringify(options.json)
            : undefined,
      })
    } catch {
      throw new Error(
        "Spaces request did not complete. Its outcome may be unknown; reconcile the existing operation before retrying.",
      )
    }
    const text = await response.text()
    if (text.length > 4 * 1024 * 1024) throw new Error("Spaces response is too large.")
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`Spaces returned an invalid response (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      const error = z.object({ code: z.string().regex(/^[a-zA-Z0-9_]+$/) }).safeParse(payload)
      throw new SpacesApiError(error.success ? error.data.code : "request_failed", response.status)
    }
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error("Spaces returned an unexpected response shape.")
    return parsed.data
  }

  public get(space: string, signal?: AbortSignal): Promise<Space> {
    return this.request("GET", spacePath(space), spaceSchema, { signal })
  }
}

export function spacePath(space: string, suffix = ""): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(space)) throw new Error("Invalid Space identifier.")
  return `/v1/spaces/${encodeURIComponent(space)}${suffix}`
}
