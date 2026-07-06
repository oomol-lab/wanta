import type { ConnectionConnectInput } from "./common.ts"

export interface ConnectorFederatedConnectBody {
  config: Extract<ConnectionConnectInput, { authType: "federated" }>["config"]
  comment?: string
  subjectTokenSource: "internal_oidc"
  target: "aliyun_oidc" | "aws_oidc" | "gcloud_oidc"
}

const federatedTargetByService: Readonly<Record<string, ConnectorFederatedConnectBody["target"]>> = {
  aliyun_oss: "aliyun_oidc",
  aliyun_sts: "aliyun_oidc",
  aws_sts: "aws_oidc",
  gcloud_sts: "gcloud_oidc",
}

function getFederatedTarget(service: string): ConnectorFederatedConnectBody["target"] {
  const target = federatedTargetByService[service]
  if (!target) {
    throw new Error(`Unsupported federated service: ${service}`)
  }
  return target
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
