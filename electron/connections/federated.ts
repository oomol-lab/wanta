import type { ConnectionConnectInput } from "./common.ts"

export interface ConnectorFederatedConnectBody {
  config: Extract<ConnectionConnectInput, { authType: "federated" }>["config"]
  label?: string
  subjectTokenSource: "internal_oidc"
  target: "aliyun_oidc"
}

export function createFederatedConnectBody(
  input: Extract<ConnectionConnectInput, { authType: "federated" }>,
): ConnectorFederatedConnectBody {
  const body: ConnectorFederatedConnectBody = {
    subjectTokenSource: "internal_oidc",
    target: "aliyun_oidc",
    config: input.config,
  }

  if (input.label !== undefined) {
    body.label = input.label
  }

  return body
}
