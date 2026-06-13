import assert from "node:assert/strict"
import { test } from "vitest"
import { createFederatedConnectBody } from "./federated.ts"

test("createFederatedConnectBody follows connector contract", () => {
  assert.deepEqual(
    createFederatedConnectBody({
      authType: "federated",
      config: {
        bucket: "bucket-a",
        durationSeconds: 1800,
        oidcProviderArn: "acs:ram::123:oidc-provider/oomol",
        policy: '{"Version":"1"}',
        roleArn: "acs:ram::123:role/oomol",
        roleSessionName: "connector-session",
      },
      label: "OSS Federated",
      service: "aliyun_oss",
    }),
    {
      subjectTokenSource: "internal_oidc",
      target: "aliyun_oidc",
      config: {
        bucket: "bucket-a",
        durationSeconds: 1800,
        oidcProviderArn: "acs:ram::123:oidc-provider/oomol",
        policy: '{"Version":"1"}',
        roleArn: "acs:ram::123:role/oomol",
        roleSessionName: "connector-session",
      },
      label: "OSS Federated",
    },
  )
})
