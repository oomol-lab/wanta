/**
 * Cache a successful external-agent command environment while allowing a
 * transient initialization failure to be retried by the next agent launch.
 * Every caller receives a copy so adapter-local mutation cannot leak across
 * Claude/ACP subprocesses.
 */
export function memoizeExternalCommandEnvironment(
  create: () => Promise<NodeJS.ProcessEnv>,
): () => Promise<NodeJS.ProcessEnv> {
  let environmentPromise: Promise<NodeJS.ProcessEnv> | undefined
  return () => {
    const current = (environmentPromise ??= create())
    void current.catch(() => {
      if (environmentPromise === current) environmentPromise = undefined
    })
    return current.then((environment) => ({ ...environment }))
  }
}
