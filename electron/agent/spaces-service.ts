import type { AppLocale } from "../app-locale.ts"
import type { HostCapabilityContext } from "./host-capability.ts"
import type { SpacesIdentity } from "./spaces-client.ts"
import type { SpacesOperation } from "./spaces-store.ts"

import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, realpath } from "node:fs/promises"
import { z } from "zod"
import { HostQuestionBroker } from "./host-question-broker.ts"
import { SpacesClient, SpacesApiError, spaceSchema, spaceJobSchema, spacePath } from "./spaces-client.ts"
import { spacesCopy } from "./spaces-copy.ts"
import { inspectSpacesProject, prepareSpacesBuild, runSpacesBuild, packSpacesBuild } from "./spaces-project.ts"
import { SpacesOperationStore, spacesDigest } from "./spaces-store.ts"

export interface SpacesPrice {
  amount: string
  currency: string
  source: string
  revision: string
  expiresAt: number
}
interface SessionScope {
  identity: SpacesIdentity
  context: HostCapabilityContext
  controller: AbortController
}
export interface SpacesServiceOptions {
  binary: string | null
  store: SpacesOperationStore
  questions: HostQuestionBroker
  locale: () => AppLocale
  /** Must come from the host's authoritative pricing integration, never tool input. */
  price: (identity: SpacesIdentity, signal: AbortSignal) => Promise<SpacesPrice | null>
  client?: (identity: SpacesIdentity) => SpacesClient
}
export interface SpacesCreateInput {
  project: string
  slug: string
  name: string
  reason: string
  requirement: "shared_persistent_data" | "server_functions_and_database"
}

export { SPACES_INSTRUCTIONS } from "./spaces-policy.ts"

/** Stateful business boundary shared by OpenCode and external agents. */
export class SpacesService {
  private readonly sessions = new Map<string, SessionScope>()
  private readonly busy = new Set<string>()
  private readonly firstDeploy = new Map<string, string>()
  private readonly options: SpacesServiceOptions
  public constructor(options: SpacesServiceOptions) {
    this.options = options
  }

  public activate(context: HostCapabilityContext, identity: SpacesIdentity): void {
    const previous = this.sessions.get(context.sessionId)
    if (
      previous &&
      previous.context.turnId === context.turnId &&
      previous.identity.token === identity.token &&
      previous.identity.teamName === identity.teamName
    )
      return
    this.disable(context.sessionId)
    this.sessions.set(context.sessionId, { context, identity: { ...identity }, controller: new AbortController() })
  }
  public disable(sessionId: string): void {
    this.sessions.get(sessionId)?.controller.abort()
    this.sessions.delete(sessionId)
    this.firstDeploy.delete(sessionId)
  }
  public disableAll(): void {
    for (const sessionId of this.sessions.keys()) this.disable(sessionId)
  }

  private scope(context: HostCapabilityContext, signal?: AbortSignal) {
    const scope = this.sessions.get(context.sessionId)
    if (
      !scope ||
      !context.turnId ||
      scope.context.turnId !== context.turnId ||
      scope.context.teamName !== context.teamName
    )
      throw new Error("Spaces identity is unavailable or this turn has ended.")
    const combined = AbortSignal.any([
      scope.controller.signal,
      AbortSignal.timeout(20 * 60_000),
      ...(signal ? [signal] : []),
    ])
    combined.throwIfAborted()
    return {
      ...scope,
      signal: combined,
      client: this.options.client?.(scope.identity) ?? new SpacesClient(scope.identity),
    }
  }

  public async read(
    context: HostCapabilityContext,
    input: { operation: string; space?: string; jobId?: string; cursor?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const scope = this.scope(context, signal)
    if (input.operation === "list") {
      const query = new URLSearchParams({ limit: "50", ...(input.cursor ? { cursor: input.cursor } : {}) })
      return scope.client.request(
        "GET",
        `/v1/spaces?${query}`,
        z.object({ items: z.array(spaceSchema), nextCursor: z.string().nullable() }),
        { signal: scope.signal },
      )
    }
    if (!input.space) throw new Error("A Space identifier is required.")
    if (input.operation === "get") return scope.client.get(input.space, scope.signal)
    if (input.operation === "job") {
      if (!input.jobId || !/^[a-zA-Z0-9-]+$/.test(input.jobId)) throw new Error("A deployment job ID is required.")
      return scope.client.request("GET", spacePath(input.space, `/deploys/${input.jobId}`), spaceJobSchema, {
        signal: scope.signal,
      })
    }
    if (input.operation === "deploys")
      return scope.client.request(
        "GET",
        spacePath(input.space, "/deploys?limit=50"),
        z.object({ items: z.array(spaceJobSchema), nextCursor: z.string().nullable().optional() }),
        { signal: scope.signal },
      )
    if (input.operation === "usage")
      return scope.client.request(
        "GET",
        spacePath(input.space, "/usage"),
        z.object({
          from: z.string(),
          to: z.string(),
          items: z.array(
            z.object({
              day: z.string(),
              metrics: z.record(
                z.string(),
                z.object({ unit: z.string(), currentDay: z.number(), currentMonth: z.number() }),
              ),
            }),
          ),
        }),
        { signal: scope.signal },
      )
    throw new Error("Unsupported Spaces read operation.")
  }

  public async create(
    context: HostCapabilityContext,
    input: SpacesCreateInput,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const scope = this.scope(context, signal)
    await this.requireBinary()
    const project = await inspectSpacesProject(context, input.project)
    const operationId = JSON.stringify([
      scope.identity.accountId,
      scope.identity.teamName,
      project.root,
      "create",
      input.slug,
    ])
    return this.exclusive(operationId, async () => {
      let operation = await this.options.store.read(operationId)
      if (operation?.space) return { space: await scope.client.get(operation.space.id, scope.signal), reused: true }
      // A lost response must never cause a new paid create with a fresh key.
      if (operation?.status === "submitted") {
        try {
          const space = await scope.client.get(input.slug, scope.signal)
          await this.options.store.write(operationId, { ...operation, status: "completed", space })
          return { space, recovered: true }
        } catch (error) {
          if (!(error instanceof SpacesApiError) || error.status !== 404) throw error
          throw new Error(
            "The previous paid create has an unknown outcome. Reconcile it with Spaces before creating another resource; no second charge was requested.",
          )
        }
      }
      const price = await this.options.price(scope.identity, scope.signal)
      assertSpacesPrice(price)
      const copy = spacesCopy[this.options.locale()]
      const decision = await this.confirm(
        context,
        [
          copy.create,
          `${scope.identity.teamName} / ${input.name} (${input.slug})`,
          `${copy.project}: ${project.root}`,
          input.reason,
          `${price.amount} ${price.currency} / ${copy.month}`,
          price.source,
          copy.billing,
          copy.access,
        ].join("\n\n"),
        scope.signal,
        true,
      )
      if (decision !== "confirmed") return { status: decision, created: false }
      scope.signal.throwIfAborted()
      const currentPrice = await this.options.price(scope.identity, scope.signal)
      assertSpacesPrice(currentPrice)
      if (
        price.revision !== currentPrice.revision ||
        price.amount !== currentPrice.amount ||
        price.currency !== currentPrice.currency ||
        price.source !== currentPrice.source
      )
        throw new Error("Spaces pricing changed. Review the updated price before confirming again.")
      const current = await inspectSpacesProject(context, input.project)
      if (current.fingerprint !== project.fingerprint)
        throw new Error("The website changed during confirmation. Review the updated project before creating a Space.")
      const fingerprint = spacesDigest(JSON.stringify({ slug: input.slug, name: input.name, visibility: "team" }))
      operation = { key: randomUUID(), fingerprint, createdAt: Date.now(), status: "submitted" }
      // Persist before dispatch: a crash must not lose the existence of a potentially charged request.
      await this.options.store.write(operationId, operation)
      scope.signal.throwIfAborted()
      let space
      try {
        space = await scope.client.request("POST", "/v1/spaces", spaceSchema, {
          json: { slug: input.slug, name: input.name, visibility: "team" },
          key: operation.key,
          signal: scope.signal,
        })
      } catch (error) {
        // Definitive validation/auth/balance rejections are safe to propose again.
        // Transport failures, conflicts and server failures retain the uncertain journal.
        if (error instanceof SpacesApiError && [400, 401, 402, 403, 404, 422].includes(error.status)) {
          await this.options.store.write(operationId, { ...operation, status: "prepared" })
        }
        throw error
      }
      await this.options.store.write(operationId, { ...operation, status: "completed", space })
      if (!scope.signal.aborted)
        this.firstDeploy.set(
          context.sessionId,
          JSON.stringify([context.turnId, space.id, project.root, project.fingerprint]),
        )
      return {
        space,
        source: project.root,
        next: "Call spaces_deploy for this Space and project; creation and the first deployment were confirmed together.",
      }
    })
  }

  public async deploy(
    context: HostCapabilityContext,
    input: { space: string; project: string; reason: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const scope = this.scope(context, signal)
    const binary = await this.requireBinary()
    if (!context.processDir) throw new Error("Spaces deployment requires this turn's managed process directory.")
    const project = await inspectSpacesProject(context, input.project)
    const space = await scope.client.get(input.space, scope.signal)
    if (space.building)
      throw new Error(
        "Another deployment is already running for this Space. Wait for its job before changing the backend.",
      )
    if (space.status !== "live" || !space.convexDeploymentUrl)
      throw new Error("The Space is not live. Do not automatically resume it: resuming incurs a new charge.")
    const lock = JSON.stringify([scope.identity.accountId, scope.identity.teamName, "deploy", space.id])
    return this.exclusive(lock, async () => {
      const operationId = JSON.stringify([lock, project.root, project.fingerprint])
      const prior = await this.options.store.read(operationId)
      if (prior?.jobId) {
        const job = await scope.client.request("GET", spacePath(space.id, `/deploys/${prior.jobId}`), spaceJobSchema, {
          signal: scope.signal,
        })
        if (job.status !== "failed" && job.status !== "cancelled")
          return { space, job, reused: true, source: project.root }
      }
      if (prior?.status === "submitted")
        throw new Error(
          "A previous upload has an unknown outcome. Inspect the Space's deployment history before attempting another upload.",
        )
      const copy = spacesCopy[this.options.locale()]
      const grant = JSON.stringify([context.turnId, space.id, project.root, project.fingerprint])
      if (this.firstDeploy.get(context.sessionId) !== grant) {
        const decision = await this.confirm(
          context,
          [
            copy.deploy,
            `${scope.identity.teamName} / ${space.name}`,
            space.url,
            `${copy.project}: ${project.root}`,
            input.reason,
            copy.deployment,
          ].join("\n\n"),
          scope.signal,
          false,
        )
        if (decision !== "confirmed") return { status: decision, deployed: false }
      }
      this.firstDeploy.delete(context.sessionId)
      scope.signal.throwIfAborted()
      if ((await inspectSpacesProject(context, input.project)).fingerprint !== project.fingerprint)
        throw new Error("The website changed during confirmation. Confirm the updated project before deploying.")
      const build = await prepareSpacesBuild(project, context.processDir!, binary)
      // Project code never receives the account token or the host capability bearer.
      await runSpacesBuild(binary, ["install"], build, { signal: scope.signal })
      scope.signal.throwIfAborted()
      const credentials = await scope.client.request(
        "POST",
        spacePath(space.id, "/deploy-credentials"),
        z.object({
          deploymentUrl: z.url(),
          deploymentName: z.string(),
          deployKey: z.string().min(1),
          expiresAt: z.number(),
        }),
        { json: {}, key: randomUUID(), signal: scope.signal },
      )
      if (credentials.deploymentUrl !== space.convexDeploymentUrl)
        throw new Error("Spaces deployment credential target does not match the selected Space.")
      let backendDeployed = false
      try {
        await runSpacesBuild(binary, ["run", "node_modules/convex/bin/main.js", "deploy", "--yes"], build, {
          signal: scope.signal,
          secrets: [credentials.deployKey],
          extraEnv: { CONVEX_DEPLOY_KEY: credentials.deployKey },
        })
        backendDeployed = true
        await runSpacesBuild(binary, ["run", "build"], build, {
          signal: scope.signal,
          extraEnv: {
            VITE_CONVEX_URL: space.convexDeploymentUrl!,
            NEXT_PUBLIC_CONVEX_URL: space.convexDeploymentUrl!,
            PUBLIC_CONVEX_URL: space.convexDeploymentUrl!,
            CONVEX_URL: space.convexDeploymentUrl!,
          },
        })
        const zip = await packSpacesBuild(build.cwd)
        scope.signal.throwIfAborted()
        const operation: SpacesOperation = {
          key: randomUUID(),
          createdAt: Date.now(),
          status: "submitted",
          fingerprint: project.fingerprint,
          space,
        }
        await this.options.store.write(operationId, operation)
        const { job } = await scope.client.request(
          "POST",
          spacePath(space.id, "/deploys"),
          z.object({ job: spaceJobSchema }),
          { bytes: zip, key: operation.key, signal: scope.signal },
        )
        await this.options.store.write(operationId, { ...operation, status: "completed", jobId: job.id })
        return {
          space,
          job,
          backendDeployed,
          source: project.root,
          next: "Poll spaces_read operation=job until succeeded, then verify the website and database in the browser. A queued deployment is not yet published.",
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message.replaceAll(credentials.deployKey, "[redacted]") : "Deployment failed."
        throw new Error(
          `${backendDeployed ? "The backend has been updated; the frontend was not confirmed published." : "Backend deployment was attempted and may have changed live data."} ${message}`,
        )
      }
    })
  }

  private async confirm(
    context: HostCapabilityContext,
    question: string,
    signal: AbortSignal,
    prototype: boolean,
  ): Promise<"confirmed" | "cancelled" | "prototype"> {
    const copy = spacesCopy[this.options.locale()]
    const answers = await this.options.questions.ask(
      context.sessionId,
      [
        {
          header: copy.header,
          question,
          custom: false,
          multiple: false,
          options: [{ label: copy.confirm }, ...(prototype ? [{ label: copy.prototype }] : []), { label: copy.cancel }],
        },
      ],
      AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
    )
    signal.throwIfAborted()
    if (answers.length === 1 && answers[0]?.length === 1 && answers[0][0] === copy.confirm) return "confirmed"
    return prototype && answers[0]?.[0] === copy.prototype ? "prototype" : "cancelled"
  }
  private async requireBinary(): Promise<string> {
    if (!this.options.binary) throw new Error("Spaces deployment is unavailable on this platform.")
    try {
      await access(this.options.binary, constants.X_OK)
      return await realpath(this.options.binary)
    } catch {
      throw new Error(
        "The managed Spaces runtime is missing. Repair the Wanta installation before creating a paid Space.",
      )
    }
  }
  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new Error("This Spaces operation is already running. Wait for its result.")
    this.busy.add(key)
    try {
      return await work()
    } finally {
      this.busy.delete(key)
    }
  }
}

export function assertSpacesPrice(price: SpacesPrice | null): asserts price is SpacesPrice {
  if (
    !price ||
    !/^\d+(\.\d+)?$/.test(price.amount) ||
    !/^[A-Z]{3}$/.test(price.currency) ||
    !price.source ||
    !price.revision ||
    price.expiresAt <= Date.now()
  ) {
    throw new Error(
      "Spaces pricing is unavailable or expired. No paid resource was created. Continue with a local prototype until authoritative pricing is available.",
    )
  }
}
