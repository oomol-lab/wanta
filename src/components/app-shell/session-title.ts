const maxTitleLength = 28

export function buildSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return "New chat"
  }

  const chars = Array.from(normalized)
  if (chars.length <= maxTitleLength) {
    return normalized
  }
  return `${chars.slice(0, maxTitleLength).join("")}...`
}
