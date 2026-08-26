import type { PromptAgentInput } from "../contract/input.ts"

/**
 * Memoize preparation by the identity of one prompt input. The entry is held
 * weakly, so completed turns do not become app-lifetime state. This lets
 * multiple setup hooks consume one immutable per-turn snapshot.
 */
export function memoizePromptPreparation<TInput extends object, TResult>(
  prepare: (input: TInput) => Promise<TResult>,
): (input: TInput) => Promise<TResult> {
  const preparations = new WeakMap<TInput, Promise<TResult>>()
  return (input) => {
    let preparation = preparations.get(input)
    if (!preparation) {
      preparation = prepare(input)
      preparations.set(input, preparation)
    }
    return preparation
  }
}

export type PromptRouteSelectionSnapshot = Pick<PromptAgentInput, "sessionId" | "model" | "reasoningLevel">

/**
 * Capture route-bearing prompt fields synchronously before preparation can
 * yield. Callers may keep and mutate a draft object while model discovery is
 * pending; one dispatched turn must retain its submission-time selection.
 */
export function memoizePromptRoutePreparation<TResult>(
  prepare: (snapshot: PromptRouteSelectionSnapshot) => Promise<TResult>,
): (input: PromptAgentInput) => Promise<TResult> {
  return memoizePromptPreparation((input: PromptAgentInput) => {
    const snapshot: PromptRouteSelectionSnapshot = {
      sessionId: input.sessionId,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.reasoningLevel !== undefined ? { reasoningLevel: input.reasoningLevel } : {}),
    }
    return prepare(snapshot)
  })
}
