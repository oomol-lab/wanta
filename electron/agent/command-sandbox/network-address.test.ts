import { describe, expect, it } from "vitest"
import { classifyNetworkAddress, normalizeAddress, resolveApprovedNetworkTarget } from "./network-address.ts"

describe("command sandbox network address policy", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["10.0.0.1", "private"],
    ["192.168.1.20", "private"],
    ["fd00::1", "private"],
    ["169.254.169.254", "link_local"],
    ["fe80::1", "link_local"],
    ["8.8.8.8", "public"],
    ["2606:4700:4700::1111", "public"],
    ["224.0.0.1", "reserved"],
  ])("classifies %s as %s", (address, expected) => {
    expect(classifyNetworkAddress(address)).toBe(expected)
  })

  it("normalizes IPv4-mapped IPv6 before classification", () => {
    expect(normalizeAddress("::ffff:192.168.1.20")).toBe("192.168.1.20")
    expect(classifyNetworkAddress("::ffff:169.254.169.254")).toBe("link_local")
  })

  it("allows public and loopback but requires an exact private grant", async () => {
    await expect(resolveApprovedNetworkTarget("8.8.8.8", 443, [])).resolves.toMatchObject({ address: "8.8.8.8" })
    await expect(resolveApprovedNetworkTarget("127.0.0.1", 8080, [])).resolves.toMatchObject({
      address: "127.0.0.1",
    })
    await expect(resolveApprovedNetworkTarget("192.168.1.20", 443, [])).resolves.toBeNull()
    await expect(
      resolveApprovedNetworkTarget("192.168.1.20", 443, [{ address: "192.168.1.20", port: 443 }]),
    ).resolves.toMatchObject({ address: "192.168.1.20", port: 443 })
    await expect(
      resolveApprovedNetworkTarget("192.168.1.20", 444, [{ address: "192.168.1.20", port: 443 }]),
    ).resolves.toBeNull()
  })

  it("always blocks link-local, zone IDs, and invalid ports", async () => {
    await expect(
      resolveApprovedNetworkTarget("169.254.169.254", 80, [{ address: "169.254.169.254" }]),
    ).resolves.toBeNull()
    await expect(resolveApprovedNetworkTarget("fe80::1%en0", 80, [{ address: "fe80::1%en0" }])).resolves.toBeNull()
    await expect(resolveApprovedNetworkTarget("127.0.0.1", 0, [])).resolves.toBeNull()
  })
})
