import assert from "node:assert/strict"
import { test } from "vitest"
import { parseSha256, resolveRipgrepTarget, ripgrepExecutableName } from "./ripgrep.ts"

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

test("parseSha256 reads the sha256sum format (Unix assets)", () => {
  const hash = "4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e"
  assert.equal(parseSha256(`${hash}  ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz\n`), hash)
})

test("parseSha256 reads the CertUtil format (Windows assets)", () => {
  // GitHub 上 Windows zip 的 .sha256 是 CertUtil 输出：字面量 "SHA256" 在首行，
  // 真实哈希在第二行。旧实现按 split()[0] 取 token 会误把 "SHA256" 当哈希。
  const hash = "d0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1"
  const certUtil =
    "SHA256 hash of ripgrep-14.1.1-x86_64-pc-windows-msvc.zip:\n" +
    `${hash}\n` +
    "CertUtil: -hashfile command completed successfully.\n"
  assert.equal(parseSha256(certUtil), hash)
})

test("parseSha256 lowercases and returns null when no digest is present", () => {
  assert.equal(
    parseSha256("D0F534024C42AFD6CB4D38907C25CD2B249B79BBE6CC1DBEE8E3E37C2B6E25A1"),
    "d0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1",
  )
  assert.equal(parseSha256("Not Found"), null)
})
