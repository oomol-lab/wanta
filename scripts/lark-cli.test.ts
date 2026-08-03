import assert from "node:assert/strict"
import { test } from "vitest"
import { resolveLarkCliTarget } from "./lark-cli.ts"

test("resolveLarkCliTarget maps supported platforms and architectures to release assets", () => {
  assert.deepEqual(resolveLarkCliTarget("darwin", "x64"), {
    archiveKind: "tar.gz",
    assetName: "lark-cli-1.0.81-darwin-amd64.tar.gz",
    binaryName: "lark-cli",
  })
  assert.deepEqual(resolveLarkCliTarget("darwin", "arm64"), {
    archiveKind: "tar.gz",
    assetName: "lark-cli-1.0.81-darwin-arm64.tar.gz",
    binaryName: "lark-cli",
  })
  assert.deepEqual(resolveLarkCliTarget("linux", "riscv64"), {
    archiveKind: "tar.gz",
    assetName: "lark-cli-1.0.81-linux-riscv64.tar.gz",
    binaryName: "lark-cli",
  })
  assert.deepEqual(resolveLarkCliTarget("win32", "arm64"), {
    archiveKind: "zip",
    assetName: "lark-cli-1.0.81-windows-arm64.zip",
    binaryName: "lark-cli.exe",
  })
})

test("resolveLarkCliTarget rejects unsupported platform and architecture combinations", () => {
  assert.throws(() => resolveLarkCliTarget("freebsd", "x64"), /No prebuilt Lark CLI binary/u)
  assert.throws(() => resolveLarkCliTarget("darwin", "riscv64"), /No prebuilt Lark CLI binary/u)
  assert.throws(() => resolveLarkCliTarget("linux", "s390x"), /No prebuilt Lark CLI binary/u)
})
