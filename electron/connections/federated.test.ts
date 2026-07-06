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
      comment: "OSS Federated",
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
      comment: "OSS Federated",
    },
  )
})

test("createFederatedConnectBody selects cloud target from service", () => {
  assert.equal(
    createFederatedConnectBody({
      authType: "federated",
      config: { roleArn: "arn:aws:iam::123:role/example" },
      service: "aws_sts",
    }).target,
    "aws_oidc",
  )
  assert.equal(
    createFederatedConnectBody({
      authType: "federated",
      config: { serviceAccountEmail: "runner@example.iam.gserviceaccount.com" },
      service: "gcloud_sts",
    }).target,
    "gcloud_oidc",
  )
})

test("createFederatedConnectBody rejects unknown federated services", () => {
  assert.throws(
    () =>
      createFederatedConnectBody({
        authType: "federated",
        config: { roleArn: "acs:ram::123:role/oomol" },
        service: "unknown_sts",
      }),
    /Unsupported federated service: unknown_sts/,
  )
})
