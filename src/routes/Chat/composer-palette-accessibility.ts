export function composerPaletteItemElementId(paletteId: string, itemId: string): string {
  return `${paletteId}-option-${encodeURIComponent(itemId)}`
}
