import type { PrivateNetworkGrant } from "./policy.ts"

import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

export type NetworkAddressClass = "link_local" | "loopback" | "private" | "public" | "reserved"

export interface ApprovedNetworkTarget {
  address: string
  family: 4 | 6
  host: string
  port: number
}

export interface PrivateNetworkRequest {
  address: string
  host: string
  port: number
}

const loopback = new BlockList()
loopback.addSubnet("127.0.0.0", 8, "ipv4")
loopback.addAddress("::1", "ipv6")

const privateNetworks = new BlockList()
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4")
privateNetworks.addSubnet("100.64.0.0", 10, "ipv4")
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4")
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4")
privateNetworks.addSubnet("fc00::", 7, "ipv6")

const linkLocal = new BlockList()
linkLocal.addSubnet("169.254.0.0", 16, "ipv4")
linkLocal.addSubnet("fe80::", 10, "ipv6")

const reserved = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as Array<[string, number]>) {
  reserved.addSubnet(network, prefix, "ipv4")
}
reserved.addAddress("::", "ipv6")
reserved.addSubnet("2001:db8::", 32, "ipv6")
reserved.addSubnet("ff00::", 8, "ipv6")

export async function resolveApprovedNetworkTarget(
  host: string,
  port: number,
  grants: readonly PrivateNetworkGrant[],
  authorizePrivate?: (request: PrivateNetworkRequest) => Promise<boolean>,
): Promise<ApprovedNetworkTarget | null> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || host.includes("%")) {
    return null
  }
  const normalizedHost = normalizeAddress(host)
  const addresses =
    isIP(normalizedHost) === 0
      ? await lookup(normalizedHost, { all: true, verbatim: true }).catch(() => [])
      : [{ address: normalizedHost, family: isIP(normalizedHost) }]
  if (addresses.length === 0) {
    return null
  }
  const normalized = addresses.map(({ address, family }) => {
    const normalizedAddress = normalizeAddress(address)
    return {
      address: normalizedAddress,
      family: isIP(normalizedAddress) || family,
      classification: classifyNetworkAddress(normalizedAddress),
    }
  })
  if (normalized.some(({ classification }) => classification === "link_local" || classification === "reserved")) {
    return null
  }
  const privateTargets = normalized.filter(({ classification }) => classification === "private")
  if (privateTargets.length > 0) {
    if (normalized.length !== 1) return null
    const privateTarget = privateTargets[0]
    const allowed =
      hasPrivateGrant(grants, privateTarget.address, port) ||
      (authorizePrivate
        ? await authorizePrivate({ address: privateTarget.address, host: normalizedHost, port })
        : false)
    if (!allowed) return null
  }
  const target = normalized[0]
  if (target.family !== 4 && target.family !== 6) {
    return null
  }
  return {
    address: target.address,
    family: target.family,
    host: normalizedHost,
    port,
  }
}

export function classifyNetworkAddress(address: string): NetworkAddressClass {
  const normalized = normalizeAddress(address)
  const family = isIP(normalized)
  if (family === 0) return "reserved"
  const type = family === 4 ? "ipv4" : "ipv6"
  if (loopback.check(normalized, type)) return "loopback"
  if (linkLocal.check(normalized, type)) return "link_local"
  if (privateNetworks.check(normalized, type)) return "private"
  if (reserved.check(normalized, type)) return "reserved"
  return "public"
}

export function normalizeAddress(address: string): string {
  const lower = address.trim().toLowerCase()
  const bracketless = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bracketless)
  return mapped?.[1] ?? bracketless
}

function hasPrivateGrant(grants: readonly PrivateNetworkGrant[], address: string, port: number): boolean {
  return grants.some(
    (grant) => normalizeAddress(grant.address) === address && (grant.port === undefined || grant.port === port),
  )
}
