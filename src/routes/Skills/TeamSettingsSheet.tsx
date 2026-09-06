import type * as React from "react"

import { ManagementSheet } from "@/components/ManagementSheet"

export function TeamSettingsSheet(props: {
  children: React.ReactNode
  onClose: () => void
  open: boolean
  title: string
}) {
  return <ManagementSheet {...props} wide />
}
