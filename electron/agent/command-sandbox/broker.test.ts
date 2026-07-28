import type { PolicyReviewerTarget, PrivateNetworkReviewInput } from "./policy-reviewer.ts"

import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandSandboxBroker } from "./broker.ts"

const brokers: CommandSandboxBroker[] = []

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()))
})

describe("command sandbox broker", () => {
  it("uses isolated user evidence to grant one exact private endpoint", async () => {
    const onGrantsChanged = vi.fn(async () => undefined)
    const review = vi.fn(async (_input: PrivateNetworkReviewInput, _target: PolicyReviewerTarget) => ({
      decision: "approve" as const,
      evidence: "192.168.1.20:443",
    }))
    const broker = new CommandSandboxBroker({ authKey: "broker-key", onGrantsChanged, review })
    brokers.push(broker)
    const url = await broker.start()
    broker.setSession("session-1", {
      modelTarget: { apiKey: "model-key", baseUrl: "https://models.example/v1", modelId: "quick" },
      origin: "main",
      userMessage: "访问 192.168.1.20:443 帮我测试",
    })

    await expect(request(url, "broker-key", "session-1", "192.168.1.20", 443)).resolves.toEqual({ allow: true })
    expect(review).toHaveBeenCalledOnce()
    expect(review.mock.calls[0]?.[0]).toMatchObject({
      requestedScope: { address: "192.168.1.20", host: "192.168.1.20", port: 443, protocol: "tcp" },
      userMessage: "访问 192.168.1.20:443 帮我测试",
    })
    expect(onGrantsChanged).toHaveBeenCalledWith("session-1", [{ address: "192.168.1.20", port: 443 }])

    await expect(request(url, "broker-key", "session-1", "192.168.1.20", 443)).resolves.toEqual({ allow: true })
    expect(review).toHaveBeenCalledOnce()
  })

  it("rejects invalid authentication, link-local, and unknown sessions without review", async () => {
    const review = vi.fn(async (_input: PrivateNetworkReviewInput, _target: PolicyReviewerTarget) => ({
      decision: "approve" as const,
      evidence: "target",
    }))
    const broker = new CommandSandboxBroker({
      authKey: "broker-key",
      onGrantsChanged: async () => undefined,
      review,
    })
    brokers.push(broker)
    const url = await broker.start()
    broker.setSession("session-1", {
      modelTarget: { apiKey: "", baseUrl: "http://local/v1", modelId: "local" },
      origin: "main",
      userMessage: "target",
    })

    expect((await fetch(`${url}/private-network`, { method: "POST" })).status).toBe(404)
    await expect(request(url, "broker-key", "session-1", "169.254.169.254", 80)).resolves.toEqual({ allow: false })
    await expect(request(url, "broker-key", "missing", "192.168.1.20", 443)).resolves.toEqual({ allow: false })
    expect(review).not.toHaveBeenCalled()
  })
})

async function request(
  url: string,
  authKey: string,
  sessionId: string,
  address: string,
  port: number,
): Promise<unknown> {
  const response = await fetch(`${url}/private-network`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ address, host: address, port, protocol: "tcp", sessionId }),
  })
  return response.json()
}
