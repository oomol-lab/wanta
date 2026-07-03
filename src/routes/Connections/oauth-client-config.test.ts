import type {
  ConnectionOAuthClientConfigFieldDefinition,
  ConnectionProviderOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import {
  buildOAuthClientConfigPayload,
  buildOAuthConnectPayload,
  buildOAuthConnectViewModel,
  shouldOpenOAuthClientDialog,
  validateOAuthPersistentFields,
} from "./oauth-client-config.ts"

const twitterOAuthConfig: ConnectionProviderOAuthClientConfigSummary = {
  clientConfigFields: [
    {
      key: "persistentScopes",
      label: "Persistent scopes",
      inputType: "string_array",
      location: "extra",
      required: true,
      secret: false,
    },
    {
      key: "appBearerToken",
      label: "App Bearer Token",
      inputType: "password",
      location: "secretExtra",
      required: false,
      secret: true,
    },
    {
      key: "sessionCode",
      label: "Session code",
      inputType: "password",
      location: "secretExtra",
      required: true,
      secret: true,
      connectOnly: true,
    },
  ],
  clientConfigPolicy: "user_required",
  configured: false,
  nextConnectSource: "unconfigured",
  oauthScopes: ["tweet.read", "users.read"],
  service: "twitter",
  tokenEndpointAuthMethod: "client_secret_basic",
}

describe("oauth-client-config", () => {
  it("opens the setup dialog when the provider requires a user OAuth client", () => {
    expect(
      shouldOpenOAuthClientDialog({
        providerOAuthClientConfig: twitterOAuthConfig,
        userOAuthClientConfig: null,
      }),
    ).toBe(true)
  })

  it("allows direct OAuth when a default client can start without extra fields", () => {
    expect(
      shouldOpenOAuthClientDialog({
        providerOAuthClientConfig: {
          ...twitterOAuthConfig,
          clientConfigFields: [],
          clientConfigPolicy: "default_only",
          configured: true,
          nextConnectSource: "default",
          tokenEndpointAuthMethod: "none",
        },
        userOAuthClientConfig: null,
      }),
    ).toBe(false)
  })

  it("keeps persistent OAuth client fields separate from connect-only fields", () => {
    const clientConfigPayload = buildOAuthClientConfigPayload({
      draft: {
        clientId: " client-id ",
        clientSecret: " client-secret ",
        extra: {
          persistentScopes: ["tweet.read", " users.read "],
        },
        secretExtra: {
          appBearerToken: " app-token ",
          sessionCode: " session-token ",
        },
      },
      fieldDefinitions: twitterOAuthConfig.clientConfigFields,
      tokenEndpointAuthMethod: twitterOAuthConfig.tokenEndpointAuthMethod,
    })

    expect(clientConfigPayload).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      extra: { persistentScopes: ["tweet.read", "users.read"] },
      secretExtra: { appBearerToken: "app-token" },
    })

    const connectPayload = buildOAuthConnectPayload({
      draft: {
        clientId: "client-id",
        clientSecret: "",
        extra: {
          persistentScopes: ["tweet.read"],
        },
        secretExtra: {
          appBearerToken: "app-token",
          sessionCode: " session-token ",
        },
      },
      fieldDefinitions: twitterOAuthConfig.clientConfigFields,
    })

    expect(connectPayload).toEqual({
      secretExtra: { sessionCode: "session-token" },
    })
  })

  it("allows resaving persisted required secret extra fields without retyping them", () => {
    const userOAuthClientConfig = {
      ...twitterOAuthConfig,
      clientId: "client-id",
      configured: true,
      expectedRedirectUri: "wanta-local://signin",
      hasSecretExtra: { appBearerToken: true },
      nextConnectSource: "custom" as const,
    }
    const providerOAuthClientConfig = {
      ...twitterOAuthConfig,
      clientConfigFields: [
        ...twitterOAuthConfig.clientConfigFields,
        {
          key: "appBearerToken",
          label: "App Bearer Token",
          inputType: "password",
          location: "secretExtra",
          required: true,
          secret: true,
        } satisfies ConnectionOAuthClientConfigFieldDefinition,
      ],
      configured: true,
      nextConnectSource: "custom" as const,
    }
    const draft = {
      clientId: "client-id",
      clientSecret: "",
      extra: { persistentScopes: ["tweet.read"] },
      secretExtra: { appBearerToken: "", sessionCode: "" },
    }
    const viewModel = buildOAuthConnectViewModel({
      currentDraft: draft,
      providerOAuthClientConfig,
      userOAuthClientConfig,
    })

    expect(validateOAuthPersistentFields(viewModel, draft, userOAuthClientConfig)).toBe(true)
  })
})
