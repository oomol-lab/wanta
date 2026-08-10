import type { ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"

import { describe, expect, it } from "vitest"
import { AGENT_PROFILES, EXTERNAL_AGENT_KINDS } from "../../../electron/agent/contract/profile.ts"
import {
  agentPickerTriggerLabel,
  buildAgentPickerRows,
  composerCapabilitiesForProfile,
} from "./agent-control-options.ts"

const labels = {
  builtIn: "Built-in Agent",
  loginRequired: (hint: string) => `Sign-in required: ${hint}`,
  notDetected: "Not detected",
}

const externalKind = EXTERNAL_AGENT_KINDS[0]!

function externalStatus(overrides: Partial<ExternalAgentRuntimeStatus>): ExternalAgentRuntimeStatus {
  return {
    kind: externalKind,
    displayName: AGENT_PROFILES[externalKind].displayName,
    binary: { status: "detected", path: "/usr/local/bin/agent", version: "2.1.0" },
    login: { status: "logged_in" },
    loginHint: "Run the agent CLI and sign in.",
    ...overrides,
  }
}

describe("composerCapabilitiesForProfile", () => {
  it("enables everything for the built-in kernel profile", () => {
    expect(composerCapabilitiesForProfile(AGENT_PROFILES.opencode)).toEqual({
      agentModesEnabled: true,
      attachmentsEnabled: true,
      modelRoutingEnabled: true,
    })
  })

  it("disables model routing, modes, and attachments for external profiles", () => {
    for (const kind of EXTERNAL_AGENT_KINDS) {
      expect(composerCapabilitiesForProfile(AGENT_PROFILES[kind])).toEqual({
        agentModesEnabled: false,
        attachmentsEnabled: false,
        modelRoutingEnabled: false,
      })
    }
  })
})

describe("buildAgentPickerRows", () => {
  it("puts the selectable built-in agent first", () => {
    const rows = buildAgentPickerRows([], labels)
    expect(rows).toEqual([{ kind: "opencode", label: "Built-in Agent", selectable: true }])
  })

  it("marks detected agents selectable with their version", () => {
    const rows = buildAgentPickerRows([externalStatus({})], labels)
    expect(rows[1]).toMatchObject({
      kind: externalKind,
      label: AGENT_PROFILES[externalKind].displayName,
      selectable: true,
      sublabel: "2.1.0",
    })
    expect(rows[1]!.hint).toBeUndefined()
  })

  it("disables undetected agents with a not-detected hint", () => {
    const rows = buildAgentPickerRows([externalStatus({ binary: { status: "not_found" } })], labels)
    expect(rows[1]).toMatchObject({ hint: "Not detected", selectable: false })
  })

  it("keeps logged-out detected agents selectable with a sign-in hint", () => {
    const rows = buildAgentPickerRows([externalStatus({ login: { status: "logged_out" } })], labels)
    expect(rows[1]).toMatchObject({
      hint: "Sign-in required: Run the agent CLI and sign in.",
      selectable: true,
    })
  })

  it("disables errored probes and surfaces the message as tooltip", () => {
    const rows = buildAgentPickerRows(
      [externalStatus({ binary: { status: "error", message: "--version failed" } })],
      labels,
    )
    expect(rows[1]).toMatchObject({ selectable: false, title: "--version failed" })
  })
})

describe("agentPickerTriggerLabel", () => {
  it("uses the i18n label for the built-in agent", () => {
    expect(agentPickerTriggerLabel("opencode", "Built-in Agent")).toBe("Built-in Agent")
  })

  it("uses the profile display name for external agents", () => {
    expect(agentPickerTriggerLabel(externalKind, "Built-in Agent")).toBe(AGENT_PROFILES[externalKind].displayName)
  })
})
