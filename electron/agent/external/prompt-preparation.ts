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
