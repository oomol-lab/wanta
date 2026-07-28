import type { CommandSandboxPolicy } from "./policy.ts"

import { createServer, get } from "node:http"
import { connect, createServer as createTcpServer } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { startCommandSandboxNetworkProxies, upstreamProxyFromEnvironment } from "./network-proxy.ts"
import { COMMAND_SANDBOX_POLICY_VERSION } from "./policy.ts"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe("command sandbox network proxy", () => {
  it("chains through the user's upstream proxy after Wanta authorizes the target", async () => {
    let receivedAuthorization: string | undefined
    let receivedUrl: string | undefined
    const upstream = createServer((request, response) => {
      receivedAuthorization = request.headers["proxy-authorization"]
      receivedUrl = request.url
      response.end("upstream-ok")
    })
    const upstreamPort = await listen(upstream)
    cleanups.push(() => close(upstream))
    const proxies = await startCommandSandboxNetworkProxies(policy(), {
      upstreamProxy: upstreamProxyFromEnvironment({
        HTTP_PROXY: `http://user:password@127.0.0.1:${upstreamPort}`,
      }),
    })
    cleanups.push(proxies.close)

    const response = await getText(`http://127.0.0.1:${proxies.httpPort}`, "http://127.0.0.1:8080/health")

    expect(response).toBe("upstream-ok")
    expect(receivedUrl).toBe("http://127.0.0.1:8080/health")
    expect(receivedAuthorization).toBe(`Basic ${Buffer.from("user:password").toString("base64")}`)
  })

  it("rejects unsupported upstream proxy protocols instead of falling back direct", () => {
    expect(() => upstreamProxyFromEnvironment({ HTTP_PROXY: "socks5://127.0.0.1:1080" })).toThrow("only HTTP or HTTPS")
  })

  it("applies NO_PROXY after Wanta authorizes the destination", async () => {
    const target = createServer((_request, response) => response.end("direct-ok"))
    const targetPort = await listen(target)
    cleanups.push(() => close(target))
    const proxies = await startCommandSandboxNetworkProxies(policy(), {
      upstreamProxy: upstreamProxyFromEnvironment({
        HTTP_PROXY: "http://127.0.0.1:1",
        NO_PROXY: "127.0.0.1",
      }),
    })
    cleanups.push(proxies.close)

    const response = await getText(`http://127.0.0.1:${proxies.httpPort}`, `http://127.0.0.1:${targetPort}/health`)

    expect(response).toBe("direct-ok")
  })

  it("does not fall back to a direct connection when the upstream proxy is unavailable", async () => {
    let targetReached = false
    const target = createServer((_request, response) => {
      targetReached = true
      response.end("should-not-be-reached")
    })
    const targetPort = await listen(target)
    cleanups.push(() => close(target))
    const proxies = await startCommandSandboxNetworkProxies(policy(), {
      upstreamProxy: upstreamProxyFromEnvironment({ HTTP_PROXY: "http://127.0.0.1:1" }),
    })
    cleanups.push(proxies.close)

    const response = await getText(`http://127.0.0.1:${proxies.httpPort}`, `http://127.0.0.1:${targetPort}/health`)

    expect(response).toBe("Bad Gateway")
    expect(targetReached).toBe(false)
  })

  it("connects SOCKS5-aware clients to loopback services", async () => {
    const target = createTcpServer((socket) => socket.once("data", (data) => socket.end(`echo:${data}`)))
    const targetPort = await listenTcp(target)
    cleanups.push(() => closeTcp(target))
    const proxies = await startCommandSandboxNetworkProxies(policy())
    cleanups.push(proxies.close)

    const response = await socksRequest(proxies.socksPort, targetPort, "hello")

    expect(response).toBe("echo:hello")
  })
})

function policy(): CommandSandboxPolicy {
  return {
    executionMode: "sandbox",
    homeDir: "/tmp/wanta-home",
    privateNetworkGrants: [],
    readOnlyPaths: [],
    readWritePaths: [],
    runtimeReadPaths: [],
    sessionId: "session",
    version: COMMAND_SANDBOX_POLICY_VERSION,
  }
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") reject(new Error("Server did not report a port."))
      else resolve(address.port)
    })
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function listenTcp(server: ReturnType<typeof createTcpServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") reject(new Error("Server did not report a port."))
      else resolve(address.port)
    })
  })
}

function closeTcp(server: ReturnType<typeof createTcpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function getText(proxyUrl: string, targetUrl: string): Promise<string> {
  const proxy = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    get(
      {
        host: proxy.hostname,
        path: targetUrl,
        port: proxy.port,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      },
    ).once("error", reject)
  })
}

function socksRequest(proxyPort: number, targetPort: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, "127.0.0.1")
    let stage: "greeting" | "request" | "response" = "greeting"
    let buffered = Buffer.alloc(0)
    socket.once("error", reject)
    socket.once("connect", () => socket.write(Buffer.from([5, 1, 0])))
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (stage === "greeting" && buffered.length >= 2) {
        expect([...buffered.subarray(0, 2)]).toEqual([5, 0])
        buffered = buffered.subarray(2)
        stage = "request"
        socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, targetPort >> 8, targetPort & 0xff]))
      }
      if (stage === "request" && buffered.length >= 10) {
        expect([...buffered.subarray(0, 2)]).toEqual([5, 0])
        buffered = buffered.subarray(10)
        stage = "response"
        socket.write(payload)
      }
      if (stage === "response" && buffered.length > 0) {
        socket.destroy()
        resolve(buffered.toString("utf8"))
      }
    })
  })
}
