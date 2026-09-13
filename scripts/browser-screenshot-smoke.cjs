// Run with the repository's downloaded Electron executable, not Node.
// Exercises the real CDP screenshot/resize race; no account or app profile is used.
const assert = require("node:assert/strict")
const { readFileSync, mkdtempSync } = require("node:fs")
const { createServer } = require("node:http")
const { registerHooks, stripTypeScriptTypes } = require("node:module")
const { tmpdir } = require("node:os")
const { join, resolve } = require("node:path")
const { pathToFileURL } = require("node:url")
const { app, BrowserWindow, session, webContents } = require("electron")

const sourceRoot = pathToFileURL(resolve(__dirname, "../electron") + "/").href
registerHooks({
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")),
        shortCircuit: true,
      }
    }
    return next(url, context)
  },
})

app.setPath("userData", mkdtempSync(join(tmpdir(), "wanta-browser-screenshot-")))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const timeout = setTimeout(() => {
  console.error("Browser screenshot smoke timed out")
  app.exit(1)
}, 60_000)

app.whenReady().then(async () => {
  let page
  let window
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html")
    response.end(`<!doctype html><style>
      body{margin:0;background:#f7f8fb}section{height:300px;padding:24px;border-bottom:2px solid #555}
      section:nth-child(even){background:#dbeafe}
      </style>${Array.from({ length: 20 }, (_, i) => `<section><h1>Scroll marker ${i}</h1></section>`).join("")}`)
  })
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { BrowserPage } = await import(sourceRoot + "browser/page.ts")
    window = new BrowserWindow({
      width: 1100,
      height: 760,
      title: "Wanta browser screenshot smoke",
      ...(process.platform === "darwin" ? { transparent: true, vibrancy: "sidebar" } : {}),
    })
    await window.loadURL("data:text/html,<body>Browser screenshot smoke</body>")
    page = new BrowserPage({
      mainWindow: window,
      partitionSession: session.fromPartition("browser-screenshot-smoke"),
      sessionId: "smoke",
      stateChanged: () => {},
      zoomFactorForUrl: () => 1,
    })
    await page.initialize()
    await page.navigate(`http://127.0.0.1:${server.address().port}/`)
    const contents = webContents.getAllWebContents().find((item) => item.id !== window.webContents.id)
    const debuggerApi = contents.debugger
    const sendCommand = debuggerApi.sendCommand.bind(debuggerApi)
    const narrow = { x: 680, y: 48, width: 400, height: 500 }
    const wide = { x: 0, y: 48, width: 1080, height: 680 }
    for (const [before, after] of [
      [narrow, wide],
      [wide, narrow],
    ]) {
      page.show(before)
      await pause(100)
      let resizedDuringCapture = false
      let captureSettled = false
      debuggerApi.sendCommand = (method, ...args) => {
        const result = sendCommand(method, ...args)
        if (method === "Page.captureScreenshot") {
          void result.then(
            () => {
              captureSettled = true
            },
            () => {
              captureSettled = true
            },
          )
          setTimeout(() => {
            resizedDuringCapture = !captureSettled
            page.show(after)
          }, 5)
        }
        return result
      }
      try {
        await page.screenshot(true)
      } finally {
        debuggerApi.sendCommand = sendCommand
      }
      await pause(100)
      assert.ok(resizedDuringCapture, "The resize must overlap the actual CDP capture")
      const viewport = await contents.executeJavaScript("({width:innerWidth,height:innerHeight})")
      assert.deepEqual(viewport, { width: after.width, height: after.height })
      await page.scroll(undefined, 0, 300)
      await pause(100)
      assert.ok(await contents.executeJavaScript("scrollY > 0"))
      console.log(JSON.stringify({ result: "pass", before, after, viewport }))
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await page?.dispose()
    window?.destroy()
    server.close()
    clearTimeout(timeout)
    app.exit(process.exitCode || 0)
  }
})
