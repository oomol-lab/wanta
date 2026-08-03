import type { WecomCliState } from "../../electron/link-runtime/common.ts"

import { describe, expect, it } from "vitest"
import { wecomCliProviderFromState } from "./useWecomCliConnection.ts"

const copy = {
  connectActionLabel: "Scan to connect",
  connectionMethodLabel: "WeCom QR code",
  description: "WeCom tools",
  displayName: "WeCom CLI",
}

describe("WeCom CLI provider model", () => {
  it("uses provider-specific QR-code copy without exposing OAuth in the provider model", () => {
    const state: WecomCliState = {
      accountLabel: "bot-id",
      activeVersion: "0.1.9",
      available: true,
      canReopenAuthorization: false,
      connection: "connected",
      phase: "idle",
    }
    const provider = wecomCliProviderFromState(state, copy, 123)

    expect(provider).toMatchObject({
      connectActionLabel: "Scan to connect",
      connectedUpdatedAt: 123,
      connectionMethodLabel: "WeCom QR code",
      executionMode: "direct",
      runtimeVersion: "0.1.9",
      service: "wecom-cli",
      status: "connected",
    })
    expect(provider.apps[0]?.id).toBe("direct:wecom-cli:default")
  })
})
