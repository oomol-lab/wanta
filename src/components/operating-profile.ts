import type { LinkRuntimeSelection, LinkRuntimeState } from "../../electron/link-runtime/common.ts"
import type { OperatingMode } from "../../electron/settings/common.ts"

export interface OperatingProfileTarget {
  linkRuntime: LinkRuntimeSelection
  mode: OperatingMode
}

export function operatingModeGateLoading({
  authenticated,
  linkRuntimeLoading,
  modelCatalogAvailable,
  modelCatalogFailed,
  operatingMode,
  settingsLoading,
}: {
  authenticated: boolean
  linkRuntimeLoading: boolean
  modelCatalogAvailable: boolean
  modelCatalogFailed: boolean
  operatingMode: OperatingMode | null
  settingsLoading: boolean
}): boolean {
  return (
    settingsLoading ||
    linkRuntimeLoading ||
    (!modelCatalogAvailable && !modelCatalogFailed) ||
    (authenticated && (operatingMode === null || operatingMode === "unselected"))
  )
}

export function initialSetupRequired(authenticated: boolean, operatingMode: OperatingMode | null): boolean {
  return !authenticated && operatingMode !== "self-managed"
}

export function operatingModeAfterSignOut(operatingMode: OperatingMode | null): OperatingMode | null {
  return operatingMode === "oomol" ? "unselected" : operatingMode
}

export function operatingProfileTarget(
  authenticated: boolean,
  operatingMode: OperatingMode | null,
): OperatingProfileTarget | null {
  if (authenticated) return { linkRuntime: "oomol", mode: "oomol" }
  if (operatingMode !== "self-managed") return null
  return { linkRuntime: "openconnector", mode: "self-managed" }
}

export function legacyOperatingMode({
  authenticated,
  hasCustomModel,
  linkRuntime,
}: {
  authenticated: boolean
  hasCustomModel: boolean
  linkRuntime: LinkRuntimeState | null
}): OperatingMode | null {
  if (authenticated) return null
  return hasCustomModel && linkRuntime?.selected === "openconnector" && linkRuntime.active === "openconnector"
    ? "self-managed"
    : null
}
