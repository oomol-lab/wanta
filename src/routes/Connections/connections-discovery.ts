// These official connections manage owned accounts, not public-content research.
const hiddenDiscoveryServices = new Set(["instagram", "bilibili"])

// Verified against the Connector topic catalogs and their action requirements.
const researchSearches = [
  { aliases: ["instagram", "ins", "ig"], services: ["tikhub", "unifapi"] },
  { aliases: ["bilibili", "b站", "哔哩哔哩"], services: ["redfox", "tikhub"] },
  { aliases: ["reddit"], services: ["aisa", "tikhub"] },
  { aliases: ["twitter", "x", "推特"], services: ["aisa", "tikhub", "redfox"] },
  { aliases: ["tiktok", "tik tok"], services: ["redfox", "tikhub"] },
  { aliases: ["tiktok shop", "tiktokshop"], services: ["kalodata", "linkfox", "sorftime_mcp"] },
]

export function isDiscoveryProviderVisible(service: string, hasConnection: boolean): boolean {
  return hasConnection || !hiddenDiscoveryServices.has(service)
}

export function getDiscoverySearchAliases(service: string): string[] {
  return researchSearches.filter((search) => search.services.includes(service)).flatMap((search) => search.aliases)
}

export function getDiscoverySearchPriority(service: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ")
  const search = researchSearches.find((search) => search.aliases.includes(normalizedQuery))
  // Only bare platform names express this intent; keep explicit business queries unchanged.
  return search?.services.includes(service) ? 0 : 1
}
