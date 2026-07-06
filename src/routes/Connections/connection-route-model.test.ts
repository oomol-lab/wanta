import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildCredentialSummaryDisplayValues,
  buildFederatedCredentialDisplayValues,
  getConnectionAppNote,
  getProviderAccountValue,
  getProviderMeta,
  isConnected,
  isNoAuthReadyProvider,
} from "./connection-route-model.ts"
import { translate } from "@/i18n/i18n"

function provider(overrides: Partial<ConnectionProviderSummary>): ConnectionProviderSummary {
  return {
    actionKind: "oauth2",
    appCount: 0,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: false,
    categoryLabels: [],
    displayName: "Provider",
    service: "provider",
    status: "available",
    ...overrides,
  }
}

test("virtual no-auth ready providers count as connected", () => {
  const ready = provider({
    actionKind: "no_auth",
    authTypes: ["no_auth"],
    displayName: "QuickChart",
    service: "quickchart",
    status: "connected",
  })

  assert.equal(isConnected(ready), true)
  assert.equal(isNoAuthReadyProvider(ready), true)
  assert.equal(
    getProviderMeta(ready, (key, vars) => translate("en", key, vars)),
    "No account required",
  )
  assert.equal(
    getProviderAccountValue(ready, (key, vars) => translate("en", key, vars)),
    "No account required",
  )
})

test("managed no-auth accounts are not treated as connectionless providers", () => {
  const ready = provider({
    actionKind: "no_auth",
    appAuthType: "no_auth",
    appCount: 1,
    appStatus: "active",
    authTypes: ["no_auth"],
    status: "connected",
  })

  assert.equal(isConnected(ready), true)
  assert.equal(isNoAuthReadyProvider(ready), false)
})

test("buildCredentialSummaryDisplayValues keeps only non-secret display values", () => {
  assert.deepEqual(
    buildCredentialSummaryDisplayValues(
      [
        { key: "apiKey", secret: true },
        { key: "workspace", secret: false },
        { key: "token", secret: true },
      ],
      {
        authType: "api_key",
        fields: {
          apiKey: { configured: true, maskedValue: "sk-***" },
          token: { configured: true, displayValue: "should-not-fill" },
          workspace: { configured: true, displayValue: "prod" },
        },
      },
    ),
    { workspace: "prod" },
  )
})

test("buildFederatedCredentialDisplayValues keeps non-secret known fields", () => {
  assert.deepEqual(
    buildFederatedCredentialDisplayValues(
      [{ key: "roleArn" }, { key: "policy" }],
      [
        { key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false },
        { key: "policy", label: "Policy", displayValue: "{}", secret: false },
        { key: "token", label: "Token", displayValue: "hidden", secret: true },
        { key: "unknown", label: "Unknown", displayValue: "ignored", secret: false },
      ],
    ),
    { policy: "{}", roleArn: "role-a" },
  )
})

test("getConnectionAppNote trims persisted comments", () => {
  assert.equal(
    getConnectionAppNote({
      authType: "federated",
      comment: " developer role ",
      createdAt: 0,
      id: "app-1",
      isDefault: false,
      service: "aliyun_sts",
      status: "active",
      updatedAt: 0,
    }),
    "developer role",
  )
})
