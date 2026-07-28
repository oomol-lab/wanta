import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CommandSandboxPolicyStore, readCommandSandboxPolicy } from "./policy.ts"
import { buildCommandSandboxEnvironment, buildDirectCommandEnvironment } from "./runtime.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("command sandbox policy", () => {
  it("canonicalizes paths and authenticates a session policy", async () => {
    const root = await temporaryRoot()
    const project = path.join(root, "project")
    const attachment = path.join(root, "attachment.txt")
    await Promise.all([mkdir(project), writeFile(attachment, "attachment")])
    const store = new CommandSandboxPolicyStore({ authKey: "test-auth-key", rootDir: path.join(root, "sandbox") })

    const written = await store.write({
      executionMode: "sandbox",
      sessionId: "session-1",
      readOnlyPaths: [attachment],
      readWritePaths: [path.join(project, "future")],
      privateNetworkGrants: [{ address: "192.168.1.20", port: 443 }],
    })
    const loaded = await readCommandSandboxPolicy(store.policyDir, "session-1", "test-auth-key")

    expect(loaded).toEqual(written)
    expect(loaded.readWritePaths).toContain(path.join(await realpath(project), "future"))
    expect(loaded.privateNetworkGrants).toEqual([{ address: "192.168.1.20", port: 443 }])
    await expect(readCommandSandboxPolicy(store.policyDir, "session-1", "wrong-key")).rejects.toThrow(
      "could not be authenticated",
    )
  })

  it("builds a clean managed-home environment without sidecar credentials", async () => {
    const root = await temporaryRoot()
    const store = new CommandSandboxPolicyStore({ authKey: "test-auth-key", rootDir: path.join(root, "sandbox") })
    const policy = await store.write({ executionMode: "sandbox", sessionId: "session-1" })
    const environment = await buildCommandSandboxEnvironment(policy, {
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      OO_API_KEY: "secret",
      WANTA_BROWSER_CONTROL_TOKEN: "secret",
      WANTA_NODE_BIN: "/Applications/Wanta.app/Contents/MacOS/Wanta",
    })

    expect(environment.HOME).toBe(policy.homeDir)
    expect(environment.PATH).toBe("/usr/bin:/bin")
    expect(environment.LANG).toBe("en_US.UTF-8")
    expect(environment.WANTA_NODE_BIN).toContain("Wanta")
    expect(environment.OO_API_KEY).toBeUndefined()
    expect(environment.WANTA_BROWSER_CONTROL_TOKEN).toBeUndefined()
    expect(await readFile(path.join(store.pathForSession("session-1")), "utf8")).not.toContain("secret")
  })

  it("builds a direct environment with the real home without sidecar credentials", () => {
    const environment = buildDirectCommandEnvironment({
      HOME: "/managed/home",
      HTTP_PROXY: "http://127.0.0.1:7890",
      OO_API_KEY: "secret",
      OPENCODE_SERVER_PASSWORD: "secret",
      PATH: "/usr/bin:/bin",
      SSH_AUTH_SOCK: "/tmp/ssh-agent",
    })

    expect(environment.HOME).toBe(os.homedir())
    expect(environment.PATH).toBe("/usr/bin:/bin")
    expect(environment.HTTP_PROXY).toBe("http://127.0.0.1:7890")
    expect(environment.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent")
    expect(environment.OO_API_KEY).toBeUndefined()
    expect(environment.OPENCODE_SERVER_PASSWORD).toBeUndefined()
  })

  it("rejects an allowed root that would expose the private policy directory", async () => {
    const root = await temporaryRoot()
    const store = new CommandSandboxPolicyStore({ authKey: "test-auth-key", rootDir: path.join(root, "sandbox") })

    await expect(
      store.write({ executionMode: "sandbox", sessionId: "session-1", readWritePaths: [root] }),
    ).rejects.toThrow("private control directory")
    await store.initialize()
    await expect(
      store.write({ executionMode: "sandbox", sessionId: "session-1", readOnlyPaths: [store.policyDir] }),
    ).rejects.toThrow("private control directory")
  })

  it("persists exact private-network grants separately from the signed command snapshot", async () => {
    const root = await temporaryRoot()
    const store = new CommandSandboxPolicyStore({ authKey: "test-auth-key", rootDir: path.join(root, "sandbox") })
    const grants = [{ address: "192.168.1.20", port: 443 }]

    await store.writeNetworkGrants("session-1", grants)

    await expect(store.readNetworkGrants("session-1")).resolves.toEqual(grants)
    await expect(store.readNetworkGrants("missing")).resolves.toEqual([])
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-command-sandbox-policy-"))
  temporaryRoots.push(root)
  return root
}
