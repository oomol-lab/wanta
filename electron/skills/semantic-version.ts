interface ParsedSemanticVersion {
  core: [number, number, number]
  prerelease: string[]
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  }
}

export function semanticVersionIsBefore(current: string | undefined, minimum: string): boolean {
  if (!current?.trim()) {
    return true
  }
  const parsedCurrent = parseSemanticVersion(current)
  const parsedMinimum = parseSemanticVersion(minimum)
  if (!parsedCurrent || !parsedMinimum) {
    return current.trim() !== minimum.trim()
  }

  for (let index = 0; index < parsedCurrent.core.length; index += 1) {
    const currentPart = parsedCurrent.core[index] ?? 0
    const minimumPart = parsedMinimum.core[index] ?? 0
    if (currentPart !== minimumPart) {
      return currentPart < minimumPart
    }
  }

  if (parsedCurrent.prerelease.length === 0) {
    return false
  }
  if (parsedMinimum.prerelease.length === 0) {
    return true
  }
  return (
    parsedCurrent.prerelease.join(".").localeCompare(parsedMinimum.prerelease.join("."), undefined, {
      numeric: true,
    }) < 0
  )
}
