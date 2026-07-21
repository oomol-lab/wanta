import type { CustomModelProvider } from "../../../electron/models/common.ts"

export interface CustomModelEndpointSelection {
  apiPlanId: string
  apiRegionId: string
}

export function customModelEndpointSelectionForBaseUrl(
  provider: CustomModelProvider | undefined,
  baseUrl: string,
): CustomModelEndpointSelection | null {
  for (const plan of provider?.apiPlans ?? []) {
    const region = plan.apiRegions?.find((item) => item.baseUrl === baseUrl)
    if (region) return { apiPlanId: plan.id, apiRegionId: region.id }
    if (!plan.apiRegions?.length && plan.baseUrl === baseUrl) {
      return { apiPlanId: plan.id, apiRegionId: "" }
    }
  }

  if (!provider?.apiPlans?.length) {
    const region = provider?.apiRegions?.find((item) => item.baseUrl === baseUrl)
    if (region) return { apiPlanId: "", apiRegionId: region.id }
  }

  return null
}
