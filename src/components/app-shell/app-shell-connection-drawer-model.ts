export interface ConnectionAuthIntent {
  action?: string
  createdAt: number
  displayName?: string
  errorCode?: string
  id: string
  message?: string
  service: string
  source: "chat"
}
