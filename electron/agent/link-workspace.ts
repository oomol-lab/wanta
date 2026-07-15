export interface LinkWorkspaceIdentity {
  organizationName: string
}

export interface ConnectionInventoryError {
  status: "error"
  errorCode: "connection_inventory_unavailable"
  operation: "list_connected_apps"
  workspace: LinkWorkspaceIdentity
  message: string
}

/** 纯转换：把已解析且可信的 workspace 身份转成 oo CLI selector。 */
export function linkWorkspaceArgs(identity: LinkWorkspaceIdentity): string[] {
  return ["--organization", identity.organizationName]
}

/** 纯转换：把连接清单异常稳定化为模型可判断的结构。 */
export function connectionInventoryError(identity: LinkWorkspaceIdentity, message: string): ConnectionInventoryError {
  return {
    status: "error",
    errorCode: "connection_inventory_unavailable",
    operation: "list_connected_apps",
    workspace: identity,
    message,
  }
}
