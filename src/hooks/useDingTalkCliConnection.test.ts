import { describe, expect, test } from "vitest"
import { dingTalkCliProviderFromState } from "./useDingTalkCliConnection.ts"

const copy = {
  connectActionLabel: "Connect DingTalk",
  connectionMethodLabel: "DingTalk browser authorization",
  description: "DingTalk work tools",
  displayName: "DingTalk CLI",
}

describe("DingTalk CLI provider", () => {
  test("maps a connected account to a direct provider", () => {
    const provider = dingTalkCliProviderFromState(
      {
        accountLabel: "OOMOL · Shaun",
        activeVersion: "1.0.55",
        available: true,
        canReopenAuthorization: false,
        connection: "connected",
        phase: "idle",
      },
      copy,
      100,
    )
    expect(provider).toMatchObject({
      accountLabel: "OOMOL · Shaun",
      appCount: 1,
      executionMode: "direct",
      runtimeVersion: "1.0.55",
      service: "dingtalk-cli",
      status: "connected",
    })
    expect(provider.apps[0]?.id).toBe("direct:dingtalk-cli:default")
  })

  test("maps expired credentials to attention", () => {
    const provider = dingTalkCliProviderFromState(
      {
        activeVersion: "1.0.55",
        available: true,
        canReopenAuthorization: false,
        connection: "expired",
        phase: "idle",
      },
      copy,
    )
    expect(provider.status).toBe("needs_attention")
    expect(provider.apps[0]?.status).toBe("reauth_required")
  })
})
