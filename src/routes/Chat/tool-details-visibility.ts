export function shouldHideToolDetailsImmediately(nextOpen: boolean, reducedMotion: boolean): boolean {
  return !nextOpen && reducedMotion
}
