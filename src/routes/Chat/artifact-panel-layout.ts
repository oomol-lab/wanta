export const artifactListDefaultHeightPx = 168
export const artifactListDefaultRatio = 0.22
export const artifactListMinHeightPx = 96
export const artifactPreviewMinHeightPx = 220

const artifactListMaxHeightRatio = 0.55

function clampArtifactListHeight(height: number, panelHeight: number): number {
  const availableAbovePreview = Math.max(0, panelHeight - artifactPreviewMinHeightPx)
  const effectiveMinHeight = artifactListMinimumHeight(panelHeight)
  const ratioMax = Math.floor(panelHeight * artifactListMaxHeightRatio)
  const maxHeight = Math.max(effectiveMinHeight, Math.min(availableAbovePreview, ratioMax))
  return Math.min(Math.max(height, effectiveMinHeight), maxHeight)
}

export function artifactListMinimumHeight(panelHeight: number): number {
  return Math.min(artifactListMinHeightPx, Math.max(0, panelHeight - artifactPreviewMinHeightPx))
}

export function artifactListHeightForRatio(ratio: number, panelHeight: number): number {
  return panelHeight > 0 ? clampArtifactListHeight(panelHeight * ratio, panelHeight) : artifactListDefaultHeightPx
}

export function artifactListRatioForHeight(height: number, panelHeight: number): number {
  if (panelHeight <= 0) {
    return artifactListDefaultRatio
  }
  return clampArtifactListHeight(height, panelHeight) / panelHeight
}

export function artifactListMaximumHeight(panelHeight: number): number {
  return clampArtifactListHeight(Number.POSITIVE_INFINITY, panelHeight)
}
