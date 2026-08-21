interface ParsedSemanticVersion {
  core: [string, string, string]
  prerelease: string[]
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    core: [match[1]!, match[2]!, match[3]!],
    prerelease: match[4]?.split(".") ?? [],
  }
}

function normalizeNumericIdentifier(value: string): string {
  return value.replace(/^0+(?=\d)/, "")
}

function compareNumericIdentifiers(left: string, right: string): number {
  const normalizedLeft = normalizeNumericIdentifier(left)
  const normalizedRight = normalizeNumericIdentifier(right)
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1
  }
  if (normalizedLeft === normalizedRight) {
    return 0
  }
  return normalizedLeft < normalizedRight ? -1 : 1
}

function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftIsNumeric = /^\d+$/.test(leftIdentifier)
    const rightIsNumeric = /^\d+$/.test(rightIdentifier)
    if (leftIsNumeric && rightIsNumeric) {
      const comparison = compareNumericIdentifiers(leftIdentifier, rightIdentifier)
      if (comparison !== 0) return comparison
      continue
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1
    }
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareSemanticVersions(left: ParsedSemanticVersion, right: ParsedSemanticVersion): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const comparison = compareNumericIdentifiers(left.core[index]!, right.core[index]!)
    if (comparison !== 0) {
      return comparison
    }
  }

  if (left.prerelease.length === 0) {
    return right.prerelease.length === 0 ? 0 : 1
  }
  if (right.prerelease.length === 0) {
    return -1
  }
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease)
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

  return compareSemanticVersions(parsedCurrent, parsedMinimum) < 0
}
