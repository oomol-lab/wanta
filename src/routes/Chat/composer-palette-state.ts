import type { ComposerTrigger } from "./composer-triggers.ts"

export type PaletteMode = "connection-accounts" | "connections" | "root" | "skills"

export interface ComposerPaletteNavigationState {
  activeIndex: number
  connectionService: string | null
  mode: PaletteMode
  triggerAnchorKey: string | null
  triggerQueryKey: string | null
}

export interface ResolvedComposerPaletteNavigation {
  activeIndex: number
  connectionService: string | null
  mode: PaletteMode
  triggerAnchorKey: string | null
  triggerQueryKey: string | null
}

export type ComposerPaletteNavigationUpdater = (
  current: ComposerPaletteNavigationState,
) => ComposerPaletteNavigationState

export const initialComposerPaletteNavigation: ComposerPaletteNavigationState = {
  activeIndex: 0,
  connectionService: null,
  mode: "root",
  triggerAnchorKey: null,
  triggerQueryKey: null,
}

function triggerAnchorKey(trigger: ComposerTrigger | null): string | null {
  return trigger ? `${trigger.kind}:${trigger.start}` : null
}

function triggerQueryKey(trigger: ComposerTrigger | null): string | null {
  return trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : null
}

function defaultPaletteMode(trigger: ComposerTrigger | null): PaletteMode {
  return trigger?.kind === "skill" ? "skills" : "root"
}

export function resolveComposerPaletteNavigation(
  state: ComposerPaletteNavigationState,
  trigger: ComposerTrigger | null,
): ResolvedComposerPaletteNavigation {
  const anchorKey = triggerAnchorKey(trigger)
  const queryKey = triggerQueryKey(trigger)
  if (!trigger) {
    return {
      activeIndex: 0,
      connectionService: null,
      mode: "root",
      triggerAnchorKey: null,
      triggerQueryKey: null,
    }
  }

  return {
    activeIndex: state.triggerAnchorKey === anchorKey && state.triggerQueryKey === queryKey ? state.activeIndex : 0,
    connectionService: state.triggerAnchorKey === anchorKey ? state.connectionService : null,
    mode: state.triggerAnchorKey === anchorKey ? state.mode : defaultPaletteMode(trigger),
    triggerAnchorKey: anchorKey,
    triggerQueryKey: queryKey,
  }
}

function sameNavigationState(left: ComposerPaletteNavigationState, right: ComposerPaletteNavigationState): boolean {
  return (
    left.activeIndex === right.activeIndex &&
    left.connectionService === right.connectionService &&
    left.mode === right.mode &&
    left.triggerAnchorKey === right.triggerAnchorKey &&
    left.triggerQueryKey === right.triggerQueryKey
  )
}

export function updateComposerPaletteNavigation(
  state: ComposerPaletteNavigationState,
  trigger: ComposerTrigger | null,
  updater: ComposerPaletteNavigationUpdater,
): ComposerPaletteNavigationState {
  const current = resolveComposerPaletteNavigation(state, trigger)
  const next = updater({
    activeIndex: current.activeIndex,
    connectionService: current.connectionService,
    mode: current.mode,
    triggerAnchorKey: current.triggerAnchorKey,
    triggerQueryKey: current.triggerQueryKey,
  })
  return sameNavigationState(state, next) ? state : next
}
