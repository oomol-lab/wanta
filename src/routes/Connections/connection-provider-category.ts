import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

export type ConnectorBusinessCategory =
  | "ai"
  | "communication"
  | "cross-border-ecommerce"
  | "data-storage"
  | "developer"
  | "investment"
  | "marketing"
  | "productivity"

const providerCategoryOverrides: Record<string, ConnectorBusinessCategory> = {
  "17track": "cross-border-ecommerce",
  adobecommerce: "cross-border-ecommerce",
  aftership: "cross-border-ecommerce",
  algolia: "data-storage",
  alibabacloud: "data-storage",
  aliyunoss: "data-storage",
  amap: "productivity",
  aivoov: "ai",
  anthropic: "ai",
  apacheairflow: "developer",
  apininjas: "developer",
  asindataapi: "cross-border-ecommerce",
  aws: "data-storage",
  awss3: "data-storage",
  baselinker: "cross-border-ecommerce",
  bigcommerce: "cross-border-ecommerce",
  box: "communication",
  browserbase: "developer",
  buildkite: "developer",
  cal: "productivity",
  captainbi: "cross-border-ecommerce",
  cin7core: "cross-border-ecommerce",
  circleci: "developer",
  clickup: "productivity",
  cloudflaredns: "developer",
  cloudflarer2: "data-storage",
  cloudflareworker: "developer",
  confluence: "communication",
  crowdin: "communication",
  databricks: "data-storage",
  deepseek: "ai",
  devto: "developer",
  dida365: "productivity",
  dingtalkbot: "communication",
  discord: "communication",
  discordbot: "communication",
  dockerhub: "developer",
  docparser: "communication",
  dropbox: "communication",
  easypost: "cross-border-ecommerce",
  elevenlabs: "ai",
  exa: "ai",
  falai: "ai",
  feishu: "communication",
  feishuappbot: "communication",
  feishucustombot: "communication",
  figma: "productivity",
  financialmodelingprep: "investment",
  firecrawl: "developer",
  gemini: "ai",
  giphy: "marketing",
  github: "developer",
  gitlab: "developer",
  gmail: "communication",
  googleanalytics: "marketing",
  googlebigquery: "data-storage",
  googlecalendar: "productivity",
  googledocs: "communication",
  googledrive: "communication",
  googleforms: "productivity",
  googlephotos: "communication",
  googlesearchconsole: "marketing",
  googlesheets: "productivity",
  googleslides: "communication",
  googletasks: "productivity",
  helium10: "cross-border-ecommerce",
  hithinkfinance: "investment",
  hubspot: "marketing",
  jira: "productivity",
  jumpseller: "cross-border-ecommerce",
  klaviyo: "marketing",
  linear: "productivity",
  lingxing: "cross-border-ecommerce",
  lingxingmcp: "cross-border-ecommerce",
  linkfox: "cross-border-ecommerce",
  mailchimp: "marketing",
  mailgun: "communication",
  metaads: "marketing",
  monday: "productivity",
  notion: "communication",
  openai: "ai",
  outlook: "communication",
  perplexity: "ai",
  printify: "cross-border-ecommerce",
  resend: "communication",
  sellerspace: "cross-border-ecommerce",
  sellersprite: "cross-border-ecommerce",
  sellerspritemcp: "cross-border-ecommerce",
  sendgrid: "communication",
  shipbob: "cross-border-ecommerce",
  shipengine: "cross-border-ecommerce",
  shippo: "cross-border-ecommerce",
  shipstation: "cross-border-ecommerce",
  shopify: "cross-border-ecommerce",
  shopifyadmin: "cross-border-ecommerce",
  shopifypartner: "cross-border-ecommerce",
  shopifystorefront: "cross-border-ecommerce",
  sif: "cross-border-ecommerce",
  slack: "communication",
  snowflake: "data-storage",
  sorftime: "cross-border-ecommerce",
  storecensus: "cross-border-ecommerce",
  storeleads: "cross-border-ecommerce",
  stripe: "marketing",
  telegram: "communication",
  trello: "productivity",
  triplewhale: "cross-border-ecommerce",
  twilio: "communication",
  vercel: "developer",
  vtex: "cross-border-ecommerce",
  woocommerce: "cross-border-ecommerce",
}

const categoryKeywords: Record<ConnectorBusinessCategory, readonly string[]> = {
  ai: [
    "ai",
    "agent",
    "anthropic",
    "claude",
    "deepseek",
    "elevenlabs",
    "embedding",
    "exa",
    "fal",
    "gemini",
    "llm",
    "model",
    "openai",
    "perplexity",
    "prompt",
    "speech",
    "transcribe",
    "vector",
  ],
  productivity: [
    "airtable",
    "amap",
    "asana",
    "calendar",
    "calendly",
    "clickup",
    "figma",
    "gaode",
    "jira",
    "linear",
    "monday",
    "project",
    "schedule",
    "task",
    "todo",
    "trello",
    "workflow",
  ],
  "cross-border-ecommerce": [
    "amazon seller",
    "amazon marketplace",
    "asin data",
    "cross border ecommerce",
    "ecommerce",
    "lingxing",
    "seller sprite",
    "sellerspace",
    "sellersprite",
    "shopify",
    "跨境电商",
  ],
  investment: [
    "alpaca",
    "binance",
    "brokerage",
    "bybit",
    "coinbase",
    "crypto",
    "financial modeling prep",
    "finnhub",
    "hithink finance",
    "investment",
    "investing",
    "kraken",
    "market data",
    "okx",
    "portfolio",
    "stock market",
    "trading",
    "同花顺",
    "投资",
    "股票",
    "加密货币",
  ],
  marketing: [
    "ads",
    "analytics",
    "brand",
    "commerce",
    "crm",
    "customer",
    "facebook",
    "giphy",
    "hubspot",
    "instagram",
    "klaviyo",
    "mailchimp",
    "marketing",
    "seo",
    "shopify",
    "social",
    "stripe",
    "tiktok",
  ],
  communication: [
    "box",
    "confluence",
    "crowdin",
    "doc",
    "document",
    "documentation",
    "docs",
    "dropbox",
    "drive",
    "knowledge",
    "notion",
    "paper",
    "wiki",
    "chat",
    "discord",
    "email",
    "gmail",
    "inbox",
    "mail",
    "mailgun",
    "mailjet",
    "messaging",
    "outlook",
    "resend",
    "sendgrid",
    "slack",
    "sms",
    "telegram",
    "teams",
    "twilio",
    "whatsapp",
    "zoom",
  ],
  developer: [
    "api",
    "browserbase",
    "buildkite",
    "ci",
    "circleci",
    "cloudflare worker",
    "code",
    "container",
    "debug",
    "deploy",
    "developer",
    "devops",
    "dns",
    "docker",
    "firecrawl",
    "github",
    "gitlab",
    "hosting",
    "netlify",
    "npm",
    "observability",
    "repository",
    "sdk",
    "server",
    "vercel",
  ],
  "data-storage": [
    "algolia",
    "analytics db",
    "aws",
    "bigquery",
    "bucket",
    "cloud",
    "databricks",
    "database",
    "db",
    "elastic",
    "index",
    "mongodb",
    "postgres",
    "query",
    "r2",
    "redis",
    "s3",
    "search",
    "snowflake",
    "storage",
    "warehouse",
  ],
}

const categoryResolutionOrder: readonly ConnectorBusinessCategory[] = [
  "ai",
  "productivity",
  "cross-border-ecommerce",
  "investment",
  "marketing",
  "communication",
  "developer",
  "data-storage",
]

const keywordMatchPatterns = new Map<string, RegExp>()

export function resolveConnectorBusinessCategory(
  provider: Pick<ConnectionProviderSummary, "categoryIds" | "categoryLabels" | "displayName" | "service">,
): ConnectorBusinessCategory | null {
  const override = providerCategoryOverrides[compactSearchValue(provider.service)]
  if (override) return override

  for (const value of [...(provider.categoryIds ?? []), ...provider.categoryLabels]) {
    const normalized = normalizeProviderCategory(value)
    if (isConnectorBusinessCategory(normalized)) return normalized
  }

  const searchableText = buildSearchableText([provider.service, provider.displayName])
  for (const category of categoryResolutionOrder) {
    if (categoryKeywords[category].some((keyword) => matchesKeyword(searchableText, keyword))) return category
  }
  return null
}

function normalizeProviderCategory(value: string): string {
  const normalized = normalizeSearchValue(value).replace(/\s+/g, "-")
  if (["docs", "documents", "documentation", "knowledge", "collaboration"].includes(normalized)) return "communication"
  if (["finance", "financial", "stocks", "trading", "crypto", "cryptocurrency"].includes(normalized))
    return "investment"
  return ["cross-border-e-commerce", "cross-border-commerce", "e-commerce", "ecommerce"].includes(normalized)
    ? "cross-border-ecommerce"
    : normalized
}

function isConnectorBusinessCategory(value: string): value is ConnectorBusinessCategory {
  return (
    value === "ai" ||
    value === "communication" ||
    value === "cross-border-ecommerce" ||
    value === "data-storage" ||
    value === "developer" ||
    value === "investment" ||
    value === "marketing" ||
    value === "productivity"
  )
}

function buildSearchableText(parts: string[]): string {
  return parts.map(normalizeSearchValue).filter(Boolean).join(" ")
}

function matchesKeyword(source: string, keyword: string): boolean {
  const normalized = normalizeSearchValue(keyword)
  if (!normalized) return false
  let pattern = keywordMatchPatterns.get(normalized)
  if (!pattern) {
    const boundary = "[^\\p{Script=Latin}\\p{N}\\p{M}]"
    pattern = new RegExp(`(?:^|${boundary})${normalized}(?=$|${boundary})`, "u")
    keywordMatchPatterns.set(normalized, pattern)
  }
  return pattern.test(source)
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
}

function compactSearchValue(value: string): string {
  return normalizeSearchValue(value).replace(/\s+/g, "")
}
