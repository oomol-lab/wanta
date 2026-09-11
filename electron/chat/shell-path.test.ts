import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import { resolveShellPath } from "./shell-path.ts"

test("literal POSIX and Windows paths preserve existing cwd semantics", () => {
  for (const [value, cwd] of [
    [".", "/work/project"],
    ["../other", "/work/project"],
    ["/work/project/../task", "/outside"],
    [String.raw`folder\name`, "/work/project"],
    ["../../..", "/work/project"],
  ])
    assert.equal(resolveShellPath(value!, cwd), path.posix.resolve(cwd!, value!))
  for (const [value, cwd] of [
    [".", String.raw`C:\work\project`],
    ["../other", String.raw`C:\work\project`],
    [String.raw`D:\task`, String.raw`C:\work\project`],
    [String.raw`\work\project`, String.raw`C:\outside`],
    ["/work/project", String.raw`C:\outside`],
    ["//server/share/project", String.raw`C:\outside`],
    ["child", String.raw`\\server\share\project`],
    ["../../..", String.raw`\\server\share\project`],
  ])
    assert.equal(resolveShellPath(value!, cwd), path.win32.resolve(cwd!, value!))
})

test("relative paths without cwd and drive-relative targets remain unknown", () => {
  assert.equal(resolveShellPath(".venv/bin/python"), undefined)
  assert.equal(resolveShellPath("C:other", String.raw`C:\work\project`), undefined)
  assert.equal(resolveShellPath(String.raw`\work\project`), undefined)
  assert.equal(resolveShellPath(String.raw`\work\project`, String.raw`\\server\share\outside`), undefined)
})
