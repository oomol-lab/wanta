import type { BillingRequestScope } from "@/lib/billing-client"

import * as React from "react"

export const BillingRequestScopeContext = React.createContext<BillingRequestScope | null>(null)
