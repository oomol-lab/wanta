import type { OpenConnectorSummary } from "../../electron/link-runtime/common.ts"

export type OpenConnectorDeploymentMode = "online" | "local"

export function inferOpenConnectorDeploymentMode(
  config: Pick<OpenConnectorSummary, "baseUrl" | "consoleUrl"> | undefined,
): OpenConnectorDeploymentMode {
  if (!config) return "online"
  return config.baseUrl === config.consoleUrl ? "online" : "local"
}

export function resolveOpenConnectorConsoleUrl(
  mode: OpenConnectorDeploymentMode,
  baseUrl: string,
  consoleUrl: string,
): string {
  return mode === "online" ? baseUrl : consoleUrl
}

export function hasCompleteOpenConnectorEndpoints(
  mode: OpenConnectorDeploymentMode,
  baseUrl: string,
  consoleUrl: string,
): boolean {
  return Boolean(baseUrl.trim() && (mode === "online" || consoleUrl.trim()))
}
