import assert from "node:assert/strict"
import { test } from "vitest"
import { resolveRipgrepTarget, ripgrepExecutableName } from "./ripgrep.ts"

test("ripgrep executable name follows platform conventions", () => {
  assert.equal(ripgrepExecutableName("win32"), "rg.exe")
  assert.equal(ripgrepExecutableName("darwin"), "rg")
  assert.equal(ripgrepExecutableName("linux"), "rg")
})

test("resolveRipgrepTarget maps Windows x64 to the MSVC zip asset", () => {
  assert.deepEqual(resolveRipgrepTarget("win32", "x64"), {
    archiveKind: "zip",
    archivePath: "ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe",
    assetName: "ripgrep-14.1.1-x86_64-pc-windows-msvc.zip",
    executableFileName: "rg.exe",
  })
})

test("resolveRipgrepTarget maps macOS arm64 to the Darwin tarball", () => {
  assert.deepEqual(resolveRipgrepTarget("darwin", "arm64"), {
    archiveKind: "tar.gz",
    archivePath: "ripgrep-14.1.1-aarch64-apple-darwin/rg",
    assetName: "ripgrep-14.1.1-aarch64-apple-darwin.tar.gz",
    executableFileName: "rg",
  })
})

test("resolveRipgrepTarget maps Linux x64 to the static musl tarball", () => {
  assert.deepEqual(resolveRipgrepTarget("linux", "x64"), {
    archiveKind: "tar.gz",
    archivePath: "ripgrep-14.1.1-x86_64-unknown-linux-musl/rg",
    assetName: "ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz",
    executableFileName: "rg",
  })
})
