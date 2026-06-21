import type { ConnectionSummary } from "./common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  connectionUsageSummaryDays,
  createEmptyConnectionSummary,
  createSupersededConnectionSummaryFallback,
  createUnavailableConnectionSummaryFallback,
} from "./summary-model.ts"

test("createEmptyConnectionSummary creates an explicit unavailable state", () => {
  const summary = createEmptyConnectionSummary("unavailable", "timeout")

  assert.equal(summary.status, "unavailable")
  assert.equal(summary.message, "timeout")
  assert.deepEqual(summary.providers, [])
  assert.deepEqual(summary.apps, [])
  assert.equal(summary.usage.days, connectionUsageSummaryDays)
})

test("createUnavailableConnectionSummaryFallback preserves provider catalog", () => {
  const previous: ConnectionSummary = {
    ...createEmptyConnectionSummary("ready"),
    activeConnections: 1,
    apps: [
      {
        authType: "oauth2",
        createdAt: 0,
        id: "app-1",
        isDefault: true,
        service: "gmail",
        status: "active",
        updatedAt: 123,
      },
    ],
    connectedProviderCount: 1,
    connectableProviderCount: 1,
    providerCount: 1,
    providers: [
      {
        actionKind: "oauth2",
        authTypes: ["oauth2"],
        canDisconnect: true,
        categoryLabels: ["Productivity"],
        displayName: "Gmail",
        service: "gmail",
        status: "connected",
        appCount: 1,
        apps: [
          {
            authType: "oauth2",
            createdAt: 0,
            id: "app-1",
            isDefault: true,
            service: "gmail",
            status: "active",
            updatedAt: 123,
          },
        ],
      },
    ],
  }

  const fallback = createUnavailableConnectionSummaryFallback(previous, "request failed")

  assert.equal(previous.status, "ready")
  assert.equal(fallback.status, "unavailable")
  assert.equal(fallback.message, "request failed")
  assert.deepEqual(fallback.providers, previous.providers)
  assert.deepEqual(fallback.apps, previous.apps)
  assert.equal(fallback.activeConnections, previous.activeConnections)
})

test("createSupersededConnectionSummaryFallback returns signed out for a stale account", () => {
  const fallback = createSupersededConnectionSummaryFallback({
    accountMatches: false,
    cached: createEmptyConnectionSummary("ready"),
  })

  assert.equal(fallback.status, "signed-out")
  assert.deepEqual(fallback.providers, [])
})

test("createSupersededConnectionSummaryFallback prefers current cache", () => {
  const cached = createEmptyConnectionSummary("ready")
  const fallback = createSupersededConnectionSummaryFallback({
    accountMatches: true,
    cached,
    message: "superseded",
    previous: createEmptyConnectionSummary("ready"),
  })

  assert.equal(fallback, cached)
})
