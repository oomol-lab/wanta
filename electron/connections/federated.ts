import type { ConnectionConnectInput } from "./common.ts"

export interface ConnectorFederatedConnectBody {
  config: Extract<ConnectionConnectInput, { authType: "federated" }>["config"]
  comment?: string
  subjectTokenSource: "internal_oidc"
  target: "aliyun_oidc" | "aws_oidc" | "gcloud_oidc"
}

function getFederatedTarget(service: string): ConnectorFederatedConnectBody["target"] {
  if (service === "aws_sts") {
    return "aws_oidc"
  }
  if (service === "gcloud_sts") {
    return "gcloud_oidc"
  }
  return "aliyun_oidc"
}

export function createFederatedConnectBody(
  input: Extract<ConnectionConnectInput, { authType: "federated" }>,
): ConnectorFederatedConnectBody {
  const body: ConnectorFederatedConnectBody = {
    subjectTokenSource: "internal_oidc",
    target: getFederatedTarget(input.service),
    config: input.config,
  }

  if (input.comment !== undefined) {
    body.comment = input.comment
  }

  return body
}
