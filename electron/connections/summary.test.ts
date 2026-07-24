import assert from "node:assert/strict"
import { test } from "vitest"
import { mergeConnectionSummary, normalizeConnectionAppDetail, normalizeFederatedCredentialConfig } from "./summary.ts"

const providers = [
  { service: "gmail", displayName: "Gmail", authTypes: ["oauth2" as const], categories: [{ displayName: "Email" }] },
  { service: "quickchart", displayName: "QuickChart", authTypes: ["no_auth" as const] },
  { service: "ably", displayName: "Ably", authTypes: ["api_key" as const] },
]

test("merge marks connected providers and computes counts", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "gmail", status: "active", authType: "oauth2", updatedAt: 5 }],
    providers,
  })

  assert.equal(summary.providerCount, 3)
  const gmail = summary.providers.find((provider) => provider.service === "gmail")
  assert.equal(gmail?.status, "connected")
  assert.equal(gmail?.appStatus, "active")
  assert.equal(gmail?.canDisconnect, true)
  assert.deepEqual(gmail?.categoryLabels, ["Email"])
  assert.equal(gmail?.appCount, 1)
})

test("connected providers sort before available ones", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "gmail", status: "active" }],
    providers,
  })

  assert.equal(summary.providers[0].service, "gmail")
})

test("pure no_auth connected provider cannot be disconnected", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "quickchart", status: "active" }],
    providers,
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "connected")
  assert.equal(quickchart?.canDisconnect, false)
  assert.equal(quickchart?.appCount, 1)
})

test("non-active app becomes needs_attention", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "ably", status: "reauth_required" }],
    providers,
  })
  const ably = summary.providers.find((provider) => provider.service === "ably")

  assert.equal(ably?.status, "needs_attention")
  assert.equal(ably?.appStatus, "reauth_required")
})

test("virtual no_auth app in error becomes needs_attention", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "no_auth:quickchart", service: "quickchart", status: "error", authType: "no_auth" }],
    providers,
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "needs_attention")
  assert.equal(quickchart?.appCount, 0)
  assert.equal(summary.connectedProviderCount, 0)
})

test("virtual no_auth app in active status marks provider ready without a manageable account", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "no_auth:quickchart", service: "quickchart", status: "active", authType: "no_auth" }],
    providers,
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "connected")
  assert.equal(quickchart?.appStatus, undefined)
  assert.equal(quickchart?.appCount, 0)
  assert.deepEqual(quickchart?.apps, [])
  assert.equal(quickchart?.canDisconnect, false)
})

test("mixed no_auth and API key providers remain directly available until the user configures an account", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "no_auth:pubmed", service: "pubmed", status: "active", authType: "no_auth" }],
    meta: { summary: { connectedProviderCount: 1 } },
    providers: [
      {
        service: "pubmed",
        displayName: "PubMed",
        authTypes: ["no_auth" as const, "api_key" as const],
      },
    ],
  })
  const pubmed = summary.providers[0]

  assert.equal(pubmed?.status, "connected")
  assert.equal(pubmed?.actionKind, "api_key")
  assert.equal(pubmed?.appCount, 0)
  assert.equal(summary.connectedProviderCount, 0)
})

test("pure no_auth provider is ready even when the workspace has no app row", () => {
  const summary = mergeConnectionSummary({
    apps: [],
    meta: { summary: { connectedProviderCount: 0 } },
    providers: [{ service: "quickchart", displayName: "QuickChart", authTypes: ["no_auth" as const] }],
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "connected")
  assert.equal(quickchart?.appStatus, undefined)
  assert.equal(quickchart?.appCount, 0)
  assert.deepEqual(quickchart?.apps, [])
  assert.equal(quickchart?.canDisconnect, false)
  assert.equal(summary.connectedProviderCount, 0)
})

test("connected provider count excludes no-auth providers from the backend total", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "gmail", status: "active", authType: "oauth2", updatedAt: 5 }],
    meta: { summary: { connectedProviderCount: 2 } },
    providers,
  })

  assert.equal(summary.connectedProviderCount, 1)
})

test("merge preserves multiple apps for one provider", () => {
  const summary = mergeConnectionSummary({
    apps: [
      {
        accountLabel: "first@example.com",
        authType: "oauth2",
        id: "app-1",
        isDefault: false,
        service: "gmail",
        status: "active",
        updatedAt: 5,
      },
      {
        accountLabel: "second@example.com",
        authType: "oauth2",
        id: "app-2",
        isDefault: true,
        service: "gmail",
        status: "active",
        updatedAt: 10,
      },
    ],
    providers,
  })

  const gmail = summary.providers.find((provider) => provider.service === "gmail")

  assert.equal(summary.connectedProviderCount, 1)
  assert.equal(gmail?.status, "connected")
  assert.equal(gmail?.appCount, 2)
  assert.equal(gmail?.accountLabel, "second@example.com")
  assert.equal(gmail?.appId, "app-2")
  assert.equal(gmail?.connectedUpdatedAt, 10)
  assert.deepEqual(
    gmail?.apps.map((app) => app.id),
    ["app-1", "app-2"],
  )
})

test("merge exposes connection account labels for UI distinction", () => {
  const summary = mergeConnectionSummary({
    apps: [
      {
        alias: "umo-nickname",
        authType: "oauth2",
        displayName: "Umo Nickname",
        id: "app-github",
        providerAccountId: "github-login",
        service: "github",
        status: "active",
        updatedAt: 10,
      },
      {
        authType: "oauth2",
        id: "app-gmail",
        providerAccountId: "user@example.com",
        service: "gmail",
        status: "active",
        updatedAt: 11,
      },
    ],
    providers: [
      { service: "github", displayName: "GitHub", authTypes: ["oauth2" as const] },
      { service: "gmail", displayName: "Gmail", authTypes: ["oauth2" as const] },
    ],
  })

  const github = summary.providers.find((provider) => provider.service === "github")
  const gmail = summary.providers.find((provider) => provider.service === "gmail")
  assert.equal(github?.accountLabel, "umo-nickname")
  assert.equal(gmail?.accountLabel, "user@example.com")
  assert.equal(summary.apps[0]?.accountLabel, undefined)
})

test("merge normalizes OAuth client config metadata for setup dialogs", () => {
  const summary = mergeConnectionSummary({
    apps: [],
    providers: [
      {
        service: "twitter",
        displayName: "X (Twitter)",
        authTypes: ["oauth2" as const],
        oauthClientConfig: {
          service: "twitter",
          clientConfigPolicy: "user_required",
          configured: false,
          nextConnectSource: "unconfigured",
          tokenEndpointAuthMethod: "client_secret_basic",
          oauthScopes: ["tweet.read", "users.read"],
          clientConfigFields: [
            {
              key: "appBearerToken",
              label: "App Bearer Token",
              inputType: "text",
              required: false,
              secret: false,
              location: "secretExtra",
              defaultValue: ["keep", 1, "safe"],
            },
          ],
        },
      },
    ],
  })

  const twitter = summary.providers.find((provider) => provider.service === "twitter")

  assert.equal(twitter?.oauthClientConfig?.clientConfigPolicy, "user_required")
  assert.equal(twitter?.oauthClientConfig?.tokenEndpointAuthMethod, "client_secret_basic")
  assert.deepEqual(twitter?.oauthClientConfig?.oauthScopes, ["tweet.read", "users.read"])
  assert.equal(twitter?.oauthClientConfig?.clientConfigFields[0]?.location, "secretExtra")
  assert.equal(twitter?.oauthClientConfig?.clientConfigFields[0]?.secret, true)
  assert.deepEqual(twitter?.oauthClientConfig?.clientConfigFields[0]?.defaultValue, ["keep", "safe"])
})

test("normalizes app credential detail without exposing unknown fields", () => {
  const app = normalizeConnectionAppDetail({
    id: "app-1",
    service: "aliyun_sts",
    authType: "federated",
    status: "active",
    comment: "developer role",
    credentialFields: [
      { key: "roleArn", label: "Role ARN", displayValue: "acs:ram::123:role/dev", secret: false },
      { key: "token", label: "Token", displayValue: "redacted", secret: true },
      { key: "", label: "Invalid", displayValue: "ignored", secret: false },
    ],
    credentialSummary: {
      authType: "custom_credential",
      fields: {
        username: { configured: true, displayValue: "alice" },
        password: { configured: true, maskedValue: "****" },
      },
    },
  })

  assert.equal(app?.comment, "developer role")
  assert.deepEqual(app?.credentialFields, [
    { key: "roleArn", label: "Role ARN", displayValue: "acs:ram::123:role/dev", secret: false },
    { key: "token", label: "Token", displayValue: "redacted", secret: true },
  ])
  assert.deepEqual(app?.credentialSummary?.fields.username, {
    configured: true,
    displayValue: "alice",
    maskedValue: undefined,
  })
  assert.deepEqual(app?.credentialSummary?.fields.password, {
    configured: true,
    displayValue: undefined,
    maskedValue: "****",
  })
})

test("normalizes federated credential field definitions", () => {
  const config = normalizeFederatedCredentialConfig({
    fields: [
      { key: "roleArn", label: "Role ARN", required: true, secret: false },
      { key: "durationSeconds", label: "Duration", required: false, secret: false },
      { key: "secretRole", label: "Secret role", required: false, secret: true },
      { key: "customNumber", label: "Custom number", required: false, secret: false, valueType: "number" },
      { key: "", label: "Invalid", required: true, secret: false },
    ],
  })

  assert.deepEqual(config?.fields, [
    {
      key: "roleArn",
      label: "Role ARN",
      required: true,
      secret: false,
      description: undefined,
      placeholder: undefined,
      valueType: undefined,
    },
    {
      key: "durationSeconds",
      label: "Duration",
      required: false,
      secret: false,
      description: undefined,
      placeholder: undefined,
      valueType: "number",
    },
    {
      key: "secretRole",
      label: "Secret role",
      required: false,
      secret: true,
      description: undefined,
      placeholder: undefined,
      valueType: undefined,
    },
    {
      key: "customNumber",
      label: "Custom number",
      required: false,
      secret: false,
      description: undefined,
      placeholder: undefined,
      valueType: "number",
    },
  ])
})
