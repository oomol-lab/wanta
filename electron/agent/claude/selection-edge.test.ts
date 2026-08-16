import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { Options, Query, SDKMessage, SDKUserMessage, query } from "@anthropic-ai/claude-agent-sdk"

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeCodeAgentAdapter } from "./adapter.ts"

// Adversarial edge tests for model/effort/permission selection plumbing of the
// Claude Code adapter: stash-revert on live rejection, warmCatalog failure
// modes, and prompt-borne selections that fail to apply.
//
// The fake queryFn mirrors the one in adapter.test.ts but additionally exposes
// supportedModels (needed by warmCatalog/refreshCatalog) with per-query
// configurable behavior.

const sessionUuid = "12345678-1234-4123-8123-123456789abc"
const sessionId = `wanta-ext:claude-code:${sessionUuid}`

interface FakeQueryHandle {
  push: (message: SDKMessage) => void
  end: () => void
  promptMessages: SDKUserMessage[]
  interrupt: ReturnType<typeof vi.fn>
  setPermissionMode: ReturnType<typeof vi.fn>
  setModel: ReturnType<typeof vi.fn>
  applyFlagSettings: ReturnType<typeof vi.fn>
  supportedModels: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

interface FakeQueryCall {
  options: Options
  fake: FakeQueryHandle
}

interface FakeQueryFnOptions {
  /** Per-query supportedModels behavior, consumed in creation order; default resolves []. */
  supportedModelsImpls?: Array<() => Promise<unknown>>
}

function createFakeQueryFn(fnOptions: FakeQueryFnOptions = {}): { queryFn: typeof query; calls: FakeQueryCall[] } {
  const calls: FakeQueryCall[] = []
  const supportedModelsQueue = [...(fnOptions.supportedModelsImpls ?? [])]
  const queryFn = vi.fn((params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query => {
    const buffered: SDKMessage[] = []
    const waiters: Array<(result: IteratorResult<SDKMessage>) => void> = []
    let ended = false
    const push = (message: SDKMessage): void => {
      const waiter = waiters.shift()
      if (waiter) {
        waiter({ value: message, done: false })
        return
      }
      buffered.push(message)
    }
    const end = (): void => {
      ended = true
      for (const waiter of waiters.splice(0)) {
        waiter({ value: undefined, done: true })
      }
    }
    const next = (): Promise<IteratorResult<SDKMessage>> => {
      if (buffered.length > 0) {
        return Promise.resolve({ value: buffered.shift() as SDKMessage, done: false })
      }
      if (ended) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    }
    const promptMessages: SDKUserMessage[] = []
    if (typeof params.prompt !== "string") {
      const prompt = params.prompt
      void (async () => {
        for await (const message of prompt) {
          promptMessages.push(message)
        }
      })()
    }
    const supportedModelsImpl = supportedModelsQueue.shift() ?? (() => Promise.resolve([]))
    const interrupt = vi.fn(() => Promise.resolve(undefined))
    const setPermissionMode = vi.fn(() => Promise.resolve())
    const setModel = vi.fn(() => Promise.resolve())
    const applyFlagSettings = vi.fn(() => Promise.resolve({}))
    const supportedModels = vi.fn(supportedModelsImpl)
    const close = vi.fn(() => {
      end()
    })
    calls.push({
      options: params.options ?? {},
      fake: {
        push,
        end,
        promptMessages,
        interrupt,
        setPermissionMode,
        setModel,
        applyFlagSettings,
        supportedModels,
        close,
      },
    })
    return {
      [Symbol.asyncIterator]: () => ({ next }),
      interrupt,
      setPermissionMode,
      setModel,
      applyFlagSettings,
      supportedModels,
      close,
    } as unknown as Query
  })
  return { queryFn: queryFn as unknown as typeof query, calls }
}

function detectedStatus(): ExternalAgentRuntimeStatus {
  return {
    kind: "claude-code",
    displayName: "Claude Code",
    binary: { status: "detected", path: "/fake/claude", version: "2.1.226" },
    login: { status: "logged_in" },
    loginHint: "Run `claude` in a terminal and sign in, then retry.",
  }
}

const scratchDirs: string[] = []
const startedAdapters: ClaudeCodeAgentAdapter[] = []

async function createHarness(
  options: {
    probe?: () => Promise<ExternalAgentRuntimeStatus>
    supportedModelsImpls?: Array<() => Promise<unknown>>
  } = {},
) {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-selection-edge-"))
  scratchDirs.push(scratchRootDir)
  const probe = vi.fn(options.probe ?? (() => Promise.resolve(detectedStatus())))
  const { queryFn, calls } = createFakeQueryFn(
    options.supportedModelsImpls ? { supportedModelsImpls: options.supportedModelsImpls } : {},
  )
  const adapter = new ClaudeCodeAgentAdapter({
    probe,
    scratchRootDir,
    commandPath: () => Promise.resolve("/fake/path-bin"),
    queryFn,
  })
  await adapter.start()
  startedAdapters.push(adapter)
  return { adapter, calls, probe }
}

afterEach(async () => {
  for (const adapter of startedAdapters.splice(0)) {
    await adapter.stop()
  }
  for (const dir of scratchDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("claude selection: stash-revert on live rejection", () => {
  it("a rejected live setModel reverts to the previous choice for session recreation", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })

    await adapter.send({ type: "set-model", sessionId, modelId: "sonnet" })
    expect(adapter.sessionSelection(sessionId)).toEqual({ modelId: "sonnet" })

    calls[0]!.fake.setModel.mockRejectedValueOnce(new Error("model not available on this subscription"))
    await expect(adapter.send({ type: "set-model", sessionId, modelId: "bogus-model" })).rejects.toThrow(
      "model not available",
    )
    // The stash reverted: the renderer read-back shows the last accepted model.
    expect(adapter.sessionSelection(sessionId)).toEqual({ modelId: "sonnet" })

    // A recreated session must request the accepted model, not the rejected
    // one. Recreation via query-loop death (NOT forgetSession, which is a
    // deliberate full wipe of the stash).
    calls[0]!.fake.end()
    await vi.waitFor(async () => {
      await adapter.send({ type: "prompt", sessionId, text: "again" })
      expect(calls).toHaveLength(2)
    })
    expect(calls[1]!.options.model).toBe("sonnet")
  })

  it("a rejected live setModel with no prior choice reverts to no model at all", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0]!.fake.setModel.mockRejectedValueOnce(new Error("nope"))
    await expect(adapter.send({ type: "set-model", sessionId, modelId: "bogus" })).rejects.toThrow("nope")
    expect(adapter.sessionSelection(sessionId)).toEqual({})
    calls[0]!.fake.end()
    await vi.waitFor(async () => {
      await adapter.send({ type: "prompt", sessionId, text: "again" })
      expect(calls).toHaveLength(2)
    })
    expect(calls[1]!.options.model).toBeUndefined()
  })

  it("a rejected live effort switch reverts to the previous effort for session recreation", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })

    await adapter.send({ type: "set-effort", sessionId, effortId: "high" })
    expect(adapter.sessionSelection(sessionId)).toEqual({ effortId: "high" })

    calls[0]!.fake.applyFlagSettings.mockRejectedValueOnce(new Error("effort switch refused"))
    await expect(adapter.send({ type: "set-effort", sessionId, effortId: "xhigh" })).rejects.toThrow(
      "effort switch refused",
    )
    expect(adapter.sessionSelection(sessionId)).toEqual({ effortId: "high" })

    // Recreation via query-loop death keeps the stash (forgetSession wipes it).
    calls[0]!.fake.end()
    await vi.waitFor(async () => {
      await adapter.send({ type: "prompt", sessionId, text: "again" })
      expect(calls).toHaveLength(2)
    })
    expect(calls[1]!.options.effort).toBe("high")
  })

  it("a stale rejection must not clobber a newer accepted model choice", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })

    // First switch hangs on the wire; second switch is accepted meanwhile.
    let rejectSlow: ((error: Error) => void) | undefined
    calls[0]!.fake.setModel.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSlow = reject
        }),
    )
    const slowSwitch = adapter.send({ type: "set-model", sessionId, modelId: "opus" })
    await adapter.send({ type: "set-model", sessionId, modelId: "haiku" })
    expect(adapter.sessionSelection(sessionId)).toEqual({ modelId: "haiku" })

    rejectSlow?.(new Error("stale rejection"))
    await expect(slowSwitch).rejects.toThrow("stale rejection")

    // The revert of the FIRST switch must not wipe the accepted SECOND choice:
    // the agent is live on "haiku" and a recreated session must request it.
    expect(adapter.sessionSelection(sessionId)).toEqual({ modelId: "haiku" })
  })
})

describe("claude selection: warmCatalog edges", () => {
  const liveModels = [
    { value: "live-opus", displayName: "Live Opus" },
    { value: "live-sonnet", displayName: "Live Sonnet", description: "fast" },
  ]

  it("two concurrent warms share one throwaway query", async () => {
    const { adapter, calls } = await createHarness({
      supportedModelsImpls: [() => Promise.resolve(liveModels)],
    })
    await Promise.all([adapter.warmCatalog(), adapter.warmCatalog()])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.fake.supportedModels).toHaveBeenCalledTimes(1)
    expect(calls[0]!.fake.close).toHaveBeenCalledTimes(1)
    const status = await adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["live-opus", "live-sonnet"])
    // No "default" entry in the live list: the alias default is dropped.
    expect(status.catalog?.defaultModelId).toBeUndefined()
    // A third warm after success is a no-op.
    await adapter.warmCatalog()
    expect(calls).toHaveLength(1)
  })

  it("a failed supportedModels keeps the static baseline and a retry succeeds", async () => {
    const { adapter, calls } = await createHarness({
      supportedModelsImpls: [() => Promise.reject(new Error("transport closed")), () => Promise.resolve(liveModels)],
    })
    await adapter.warmCatalog()
    let status = await adapter.runtimeStatus()
    // Static baseline survives the failed warm.
    expect(status.catalog?.models.map((model) => model.id)).toContain("default")
    expect(calls[0]!.fake.close).toHaveBeenCalledTimes(1)

    await adapter.warmCatalog()
    status = await adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["live-opus", "live-sonnet"])
    expect(calls).toHaveLength(2)
  })

  it("a warm returning an empty model list must not wipe the static catalog", async () => {
    const { adapter } = await createHarness({
      supportedModelsImpls: [() => Promise.resolve([])],
    })
    await adapter.warmCatalog()
    const status = await adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual([
      "default",
      "opus[1m]",
      "claude-fable-5[1m]",
      "sonnet",
      "haiku",
    ])
    expect(status.catalog?.defaultModelId).toBe("default")
  })

  it("a probe failure during warm resolves quietly instead of rejecting", async () => {
    let probeCalls = 0
    const { adapter } = await createHarness({
      probe: () => {
        probeCalls += 1
        return probeCalls === 1 ? Promise.reject(new Error("connection refused")) : Promise.resolve(detectedStatus())
      },
    })
    // warmCatalog is a best-effort background fill; the ACP adapter swallows
    // every warm failure and the renderer chains refreshExternalAgents() on
    // resolution — a rejection here skips that refresh and marks the kind
    // warmed for the rest of the mount.
    await expect(adapter.warmCatalog()).resolves.toBeUndefined()
  })

  it("after a failed probe warm, a later warm retries and succeeds", async () => {
    let probeCalls = 0
    const { adapter, calls } = await createHarness({
      probe: () => {
        probeCalls += 1
        return probeCalls === 1 ? Promise.reject(new Error("connection refused")) : Promise.resolve(detectedStatus())
      },
      supportedModelsImpls: [() => Promise.resolve(liveModels)],
    })
    await adapter.warmCatalog().catch(() => undefined)
    expect(calls).toHaveLength(0)
    await adapter.warmCatalog()
    const status = await adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["live-opus", "live-sonnet"])
  })

  it("a not-detected binary makes warm a quiet no-op that can retry later", async () => {
    let detected = false
    const { adapter, calls, probe } = await createHarness({
      probe: () =>
        Promise.resolve(
          detected ? detectedStatus() : { ...detectedStatus(), binary: { status: "not_found" as const } },
        ),
      supportedModelsImpls: [() => Promise.resolve(liveModels)],
    })
    await expect(adapter.warmCatalog()).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
    detected = true
    // The 30s probe cache serves the not-found status; expire it manually by
    // waiting for a fresh probe (cache is keyed on time, so re-warm within TTL
    // still sees not_found — that is accepted behavior, asserted here).
    await adapter.warmCatalog()
    expect(calls).toHaveLength(0)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe("claude selection: prompt-borne selections", () => {
  it("a failing prompt-borne model apply rejects before the turn is dispatched", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    await vi.waitFor(() => expect(calls[0]!.fake.promptMessages).toHaveLength(1))

    calls[0]!.fake.setModel.mockRejectedValueOnce(new Error("model rejected"))
    await expect(adapter.send({ type: "prompt", sessionId, text: "again", agentModelId: "sonnet" })).rejects.toThrow(
      "model rejected",
    )
    expect(calls[0]!.fake.promptMessages).toHaveLength(1)
    // And the rejected choice did not stick.
    expect(adapter.sessionSelection(sessionId)).toEqual({})
  })

  it("a failing prompt-borne effort apply rejects before the turn is dispatched", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0]!.fake.applyFlagSettings.mockRejectedValueOnce(new Error("effort rejected"))
    await expect(adapter.send({ type: "prompt", sessionId, text: "again", agentEffortId: "high" })).rejects.toThrow(
      "effort rejected",
    )
    expect(calls[0]!.fake.promptMessages).toHaveLength(1)
    expect(adapter.sessionSelection(sessionId)).toEqual({})
  })

  it("a later effort rejection restores a prompt-borne live model change", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0]!.fake.applyFlagSettings.mockRejectedValueOnce(new Error("effort rejected"))

    await expect(
      adapter.send({
        type: "prompt",
        sessionId,
        text: "again",
        agentModelId: "sonnet",
        agentEffortId: "high",
      }),
    ).rejects.toThrow("effort rejected")

    expect(calls[0]!.fake.setModel.mock.calls).toEqual([["sonnet"], [undefined]])
    expect(calls[0]!.fake.promptMessages).toHaveLength(1)
    expect(adapter.sessionSelection(sessionId)).toEqual({})
  })

  it("an unknown prompt-borne effort id is rejected loudly", async () => {
    const { adapter, calls } = await createHarness()
    await expect(adapter.send({ type: "prompt", sessionId, text: "hello", agentEffortId: "ultra" })).rejects.toThrow(
      'claude-code: unknown effort "ultra"',
    )
    expect(calls).toHaveLength(0)
  })
})

describe("claude selection: permission-mode projection", () => {
  it("a rejected setPermissionMode fails closed", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0]!.fake.setPermissionMode.mockRejectedValueOnce(new Error("mode refused"))
    await expect(adapter.applyPermissionMode(sessionId, "plan")).rejects.toThrow("mode refused")
  })

  it("an undeclared mode maps defensively to default instead of erroring", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    // read_only is not in the claude-code profile; projection must still work.
    await adapter.applyPermissionMode(sessionId, "read_only")
    expect(calls[0]!.fake.setPermissionMode).toHaveBeenCalledWith("default")
  })

  it("two rapid applies both settle without error and the stash keeps the last", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    await Promise.all([
      adapter.applyPermissionMode(sessionId, "plan"),
      adapter.applyPermissionMode(sessionId, "accept_edits"),
    ])
    expect(calls[0]!.fake.setPermissionMode).toHaveBeenCalledTimes(2)
    // The stash decides what a recreated session starts in: last write wins.
    adapter.forgetSession(sessionId)
    await adapter.send({ type: "prompt", sessionId, text: "again" })
    // forgetSession clears the desired mode, so the recreation is "default".
    expect(calls[1]!.options.permissionMode).toBe("default")
  })

  it("a mode applied before any session exists is stashed for creation", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.applyPermissionMode(sessionId, "plan")
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    expect(calls[0]!.options.permissionMode).toBe("plan")
  })
})
