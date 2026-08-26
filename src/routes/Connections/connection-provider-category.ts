import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

export type ConnectorBusinessCategory =
  | "ai"
  | "communication"
  | "cross-border-ecommerce"
  | "data-storage"
  | "developer"
  | "docs"
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
  box: "docs",
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
  confluence: "docs",
  crowdin: "docs",
  databricks: "data-storage",
  deepseek: "ai",
  devto: "developer",
  dida365: "productivity",
  dingtalkbot: "communication",
  discord: "communication",
  discordbot: "communication",
  dockerhub: "developer",
  docparser: "docs",
  dropbox: "docs",
  easypost: "cross-border-ecommerce",
  elevenlabs: "ai",
  exa: "ai",
  falai: "ai",
  feishu: "communication",
  feishuappbot: "communication",
  feishucustombot: "communication",
  figma: "productivity",
  firecrawl: "developer",
  gemini: "ai",
  giphy: "marketing",
  github: "developer",
  gitlab: "developer",
  gmail: "communication",
  googleanalytics: "marketing",
  googlebigquery: "data-storage",
  googlecalendar: "productivity",
  googledocs: "docs",
  googledrive: "docs",
  googleforms: "productivity",
  googlephotos: "docs",
  googlesearchconsole: "marketing",
  googlesheets: "productivity",
  googleslides: "docs",
  googletasks: "productivity",
  helium10: "cross-border-ecommerce",
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
  notion: "docs",
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
  docs: [
    "box",
    "confluence",
    "crowdin",
    "doc",
    "document",
    "docs",
    "documentation",
    "dropbox",
    "drive",
    "knowledge",
    "notion",
    "paper",
    "wiki",
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
    "chat",
    "discord",
    "email",
    "gmail",
    "inbox",
    "mail",
    "mailgun",
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
  "docs",
  "cross-border-ecommerce",
  "marketing",
  "communication",
  "developer",
  "data-storage",
]

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
    value === "docs" ||
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
  return normalized.length > 3
    ? source.includes(normalized)
    : source.split(/[^\p{Script=Latin}\p{N}]+/u).includes(normalized)
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
