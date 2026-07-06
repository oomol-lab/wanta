import { describe, expect, it } from "vitest"
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./organization-provider-access.ts"

describe("organization provider access", () => {
  it("parses connector provider grants", () => {
    const parsed = parseProviderGrants({
      "user::a": {
        connector: [{ method: "POST", provider: ["gmail", "slack"] }],
      },
      "user::b": {
        connector: [{ actions: ["*"], method: "*", provider: "*" }],
      },
    })

    expect(parsed).toEqual({
      access: {
        "user::a": {
          connector: [{ method: "POST", provider: ["gmail", "slack"] }],
        },
        "user::b": {
          connector: [{ actions: ["*"], method: "*", provider: "*" }],
        },
      },
      grants: [
        { allProviders: false, providers: ["gmail", "slack"], userId: "a" },
        { allProviders: true, providers: [], userId: "b" },
      ],
      ok: true,
    })
  })

  it("parses array methods, wildcard providers, and ignores unrelated subjects", () => {
    const parsed = parseProviderGrants({
      "team::ignored": {
        connector: [{ method: "POST", provider: ["github"] }],
      },
      "user::a": {
        connector: [{ method: ["GET", "POST"], provider: ["slack", "gmail"] }],
      },
      "user::b": {
        connector: [{ actions: ["*"], method: "*", provider: "*" }],
      },
    })

    expect(parsed).toEqual({
      access: expect.any(Object),
      grants: [
        { allProviders: false, providers: ["gmail", "slack"], userId: "a" },
        { allProviders: true, providers: [], userId: "b" },
      ],
      ok: true,
    })
  })

  it("sets and replaces provider grants without touching unrelated rules", () => {
    const access = setProviderGrant(
      {
        "user::a": {
          connector: [
            { method: "GET", provider: "gmail" },
            { method: "POST", provider: "slack" },
          ],
        },
      },
      "a",
      ["github", "gmail", "github"],
      false,
    )

    expect(access).toEqual({
      "user::a": {
        connector: [
          { method: "GET", provider: "gmail" },
          { method: "POST", provider: ["github", "gmail"] },
        ],
      },
    })
  })

  it("sets wildcard provider access and preserves unrelated service rules", () => {
    const access = setProviderGrant(
      {
        "user::a": {
          connector: [{ method: "POST", provider: ["gmail"] }],
          otherService: [{ action: "keep" }],
        },
      },
      "a",
      [],
      true,
    )

    expect(access).toEqual({
      "user::a": {
        connector: [{ actions: ["*"], method: "POST", provider: "*" }],
        otherService: [{ action: "keep" }],
      },
    })
  })

  it("removes provider grants and preserves non-provider connector rules", () => {
    const access = removeProviderGrant(
      {
        "user::a": {
          connector: [
            { method: "POST", provider: "slack" },
            { method: "POST", parameters: { ok: true }, provider: "gmail" },
          ],
          other: [{ allow: true }],
        },
      },
      "a",
    )

    expect(access).toEqual({
      "user::a": {
        connector: [{ method: "POST", parameters: { ok: true }, provider: "gmail" }],
        other: [{ allow: true }],
      },
    })
  })

  it("removes an empty user subject after revoking the last provider grant", () => {
    const access = removeProviderGrant(
      {
        "user::a": {
          connector: [{ method: "POST", provider: ["slack"] }],
        },
      },
      "a",
    )

    expect(access).toEqual({})
  })
})
