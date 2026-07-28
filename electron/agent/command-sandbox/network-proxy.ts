import type { ApprovedNetworkTarget, PrivateNetworkRequest } from "./network-address.ts"
import type { CommandSandboxPolicy } from "./policy.ts"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

import { createServer as createSocksServer } from "@pondwader/socks5-server"
import { createServer, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, connect, isIP } from "node:net"
import { connect as connectTls } from "node:tls"
import { resolveApprovedNetworkTarget } from "./network-address.ts"

export interface CommandSandboxNetworkProxies {
  close: () => Promise<void>
  httpPort: number
  socksPort: number
}

export interface UpstreamProxyConfiguration {
  http?: URL
  https?: URL
  noProxy: string[]
}

export async function startCommandSandboxNetworkProxies(
  policy: CommandSandboxPolicy,
  options: {
    authorizePrivate?: (request: PrivateNetworkRequest) => Promise<boolean>
    upstreamProxy?: UpstreamProxyConfiguration
  } = {},
): Promise<CommandSandboxNetworkProxies> {
  const resolve = (host: string, port: number) =>
    resolveApprovedNetworkTarget(host, port, policy.privateNetworkGrants, options.authorizePrivate)
  const httpServer = createServer()
  httpServer.on("connect", (request, client, head) => {
    void handleConnect(request.url, client, head, resolve, options.upstreamProxy)
  })
  httpServer.on("request", (request, response) => {
    void handleHttpRequest(request, response, resolve, options.upstreamProxy)
  })
  const httpPort = await listenHttpServer(httpServer)

  const socksServer = createSocksServer()
  socksServer.setRulesetValidator(async (connection) => {
    const target = await resolve(connection.destAddress, connection.destPort)
    connection.metadata = { target }
    return target !== null
  })
  socksServer.setConnectionHandler((connection, sendStatus) => {
    const target = (connection.metadata as { target?: ApprovedNetworkTarget }).target
    if (!target) {
      sendStatus("CONNECTION_NOT_ALLOWED")
      connection.socket.destroy()
      return
    }
    void connectTarget(target, options.upstreamProxy, true).then(
      (upstream) => {
        sendStatus("REQUEST_GRANTED")
        upstream.pipe(connection.socket)
        connection.socket.pipe(upstream)
        connection.socket.once("close", () => upstream.destroy())
        connection.socket.once("error", () => upstream.destroy())
      },
      () => {
        sendStatus("HOST_UNREACHABLE")
        connection.socket.destroy()
      },
    )
  })
  const socksPort = await listenSocksServer(socksServer)

  return {
    httpPort,
    socksPort,
    close: async () => {
      await Promise.all([closeServer(httpServer), closeSocksServer(socksServer)])
    },
  }
}

async function handleConnect(
  requestTarget: string | undefined,
  client: Duplex,
  head: Buffer,
  resolve: (host: string, port: number) => Promise<ApprovedNetworkTarget | null>,
  upstreamProxy: UpstreamProxyConfiguration | undefined,
): Promise<void> {
  const parsed = parseConnectTarget(requestTarget)
  if (!parsed) {
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n")
    return
  }
  const target = await resolve(parsed.host, parsed.port)
  if (!target || client.destroyed) {
    client.end("HTTP/1.1 403 Forbidden\r\nX-Proxy-Error: blocked-by-wanta\r\n\r\n")
    return
  }
  let upstream: Duplex
  try {
    upstream = await connectTarget(target, upstreamProxy, true)
    if (client.destroyed) {
      upstream.destroy()
      return
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head.length > 0) upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  } catch {
    if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
    return
  }
  upstream.once("error", () => client.destroy())
  client.once("close", () => upstream.destroy())
  client.once("error", () => upstream.destroy())
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  resolve: (host: string, port: number) => Promise<ApprovedNetworkTarget | null>,
  upstreamProxy: UpstreamProxyConfiguration | undefined,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "")
    if (url.protocol !== "http:") {
      response.writeHead(400)
      response.end("Unsupported proxy protocol")
      return
    }
    const port = url.port ? Number(url.port) : 80
    const target = await resolve(url.hostname, port)
    if (!target || request.socket.destroyed) {
      response.writeHead(403, { "X-Proxy-Error": "blocked-by-wanta" })
      response.end("Connection blocked by Wanta")
      return
    }
    const headers: IncomingHttpHeaders = { ...request.headers, host: url.host }
    delete headers["proxy-authorization"]
    delete headers["proxy-connection"]
    const parentProxy = selectUpstreamProxy(upstreamProxy, target, false)
    const proxyAuthorization = parentProxy ? proxyAuthorizationHeader(parentProxy) : undefined
    const requestFn = parentProxy?.protocol === "https:" ? httpsRequest : httpRequest
    const upstream = requestFn(
      parentProxy
        ? {
            headers: {
              ...headers,
              ...(proxyAuthorization ? { "proxy-authorization": proxyAuthorization } : {}),
            },
            host: parentProxy.hostname,
            method: request.method,
            path: `http://${formatHost(target.address)}:${target.port}${url.pathname}${url.search}`,
            port: proxyPort(parentProxy),
            ...(parentProxy.protocol === "https:" ? { servername: parentProxy.hostname } : {}),
          }
        : {
            family: target.family,
            headers,
            host: target.address,
            method: request.method,
            path: `${url.pathname}${url.search}`,
            port: target.port,
          },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      },
    )
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502)
      response.end("Bad Gateway")
    })
    response.once("close", () => upstream.destroy())
    request.pipe(upstream)
  } catch {
    response.writeHead(400)
    response.end("Invalid proxy request")
  }
}

export function upstreamProxyFromEnvironment(environment: NodeJS.ProcessEnv): UpstreamProxyConfiguration | undefined {
  const http = parseProxyUrl(environment.HTTP_PROXY ?? environment.http_proxy)
  const https = parseProxyUrl(environment.HTTPS_PROXY ?? environment.https_proxy)
  if (!http && !https) return undefined
  return {
    ...(http ? { http } : {}),
    ...(https ? { https } : {}),
    noProxy: (environment.NO_PROXY ?? environment.no_proxy ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }
}

async function connectTarget(
  target: ApprovedNetworkTarget,
  configuration: UpstreamProxyConfiguration | undefined,
  preferHttps: boolean,
): Promise<Duplex> {
  const parentProxy = selectUpstreamProxy(configuration, target, preferHttps)
  if (!parentProxy) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: target.address, port: target.port, family: target.family })
      socket.once("connect", () => resolve(socket))
      socket.once("error", reject)
    })
  }
  const proxySocket = await connectProxy(parentProxy)
  const destination = `${formatHost(target.address)}:${target.port}`
  const authorization = proxyAuthorizationHeader(parentProxy)
  proxySocket.write(
    [
      `CONNECT ${destination} HTTP/1.1`,
      `Host: ${destination}`,
      ...(authorization ? [`Proxy-Authorization: ${authorization}`] : []),
      "Connection: keep-alive",
      "",
      "",
    ].join("\r\n"),
  )
  return await waitForConnectResponse(proxySocket)
}

function connectProxy(proxy: URL): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    if (proxy.protocol === "https:") {
      const socket = connectTls({ host: proxy.hostname, port: proxyPort(proxy), servername: proxy.hostname })
      socket.once("secureConnect", () => resolve(socket))
      socket.once("error", reject)
      return
    }
    const socket = connect({ host: proxy.hostname, port: proxyPort(proxy) })
    socket.once("connect", () => resolve(socket))
    socket.once("error", reject)
  })
}

function waitForConnectResponse(socket: Duplex): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk])
      if (response.length > 16_384) {
        cleanup()
        socket.destroy()
        reject(new Error("Upstream proxy response is too large."))
        return
      }
      const headerEnd = response.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      cleanup()
      const statusLine = response.subarray(0, response.indexOf("\r\n")).toString("ascii")
      if (!/^HTTP\/1\.[01] 2\d\d(?: |$)/u.test(statusLine)) {
        socket.destroy()
        reject(new Error("Upstream proxy rejected the connection."))
        return
      }
      const remaining = response.subarray(headerEnd + 4)
      if (remaining.length > 0) socket.unshift(remaining)
      resolve(socket)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("Upstream proxy closed before establishing the tunnel."))
    }
    const cleanup = () => {
      socket.off("data", onData)
      socket.off("error", onError)
      socket.off("close", onClose)
    }
    socket.on("data", onData)
    socket.once("error", onError)
    socket.once("close", onClose)
  })
}

function selectUpstreamProxy(
  configuration: UpstreamProxyConfiguration | undefined,
  target: ApprovedNetworkTarget,
  preferHttps: boolean,
): URL | undefined {
  if (!configuration || shouldBypassUpstream(configuration.noProxy, target)) return undefined
  return preferHttps ? (configuration.https ?? configuration.http) : configuration.http
}

function shouldBypassUpstream(entries: readonly string[], target: ApprovedNetworkTarget): boolean {
  const host = target.host.toLowerCase()
  const address = target.address.toLowerCase()
  return entries.some((entry) => {
    const normalized = entry.toLowerCase()
    if (normalized === "*") return true
    const cidr = normalized.split("/")
    if (cidr.length === 2) {
      const network = cidr[0]
      const family = isIP(network)
      const prefix = Number(cidr[1])
      if (family !== 0 && Number.isInteger(prefix) && prefix >= 0 && prefix <= (family === 4 ? 32 : 128)) {
        try {
          const block = new BlockList()
          block.addSubnet(network, prefix, family === 4 ? "ipv4" : "ipv6")
          return block.check(address, target.family === 4 ? "ipv4" : "ipv6")
        } catch {
          return false
        }
      }
    }
    const withoutPort = normalized.startsWith("[")
      ? normalized.slice(1, normalized.indexOf("]"))
      : normalized.replace(/:\d+$/u, "")
    if (withoutPort === host || withoutPort === address) return true
    const suffix = withoutPort.startsWith(".") ? withoutPort : `.${withoutPort}`
    return host.endsWith(suffix)
  })
}

function parseProxyUrl(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined
  const proxy = new URL(value)
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new Error("Command Sandbox supports only HTTP or HTTPS upstream proxies.")
  }
  return proxy
}

function proxyAuthorizationHeader(proxy: URL): string | undefined {
  if (!proxy.username && !proxy.password) return undefined
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
}

function proxyPort(proxy: URL): number {
  return Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80)
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host
}

function parseConnectTarget(value: string | undefined): { host: string; port: number } | null {
  if (!value) return null
  try {
    const url = new URL(`http://${value}`)
    const port = Number(url.port)
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return null
    return { host: url.hostname, port }
  } catch {
    return null
  }
}

function listenHttpServer(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("The command sandbox HTTP proxy did not report its port."))
        return
      }
      resolve(address.port)
    })
  })
}

function listenSocksServer(server: ReturnType<typeof createSocksServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    const internal = (server as unknown as { server: import("node:net").Server }).server
    internal.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      internal.off("error", reject)
      const address = internal.address()
      if (!address || typeof address === "string") {
        reject(new Error("The command sandbox SOCKS proxy did not report its port."))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error)
      else resolve()
    })
  })
}

function closeSocksServer(server: ReturnType<typeof createSocksServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
