import assert from "node:assert/strict"
import { test } from "vitest"
import {
  commandWithoutSafeDescriptorDuplication,
  explicitCdDirectory,
  shellWordsWithoutRedirections,
} from "./shell-syntax.ts"

test("explicit cd directories accept literal paths and literal assignments", () => {
  assert.equal(explicitCdDirectory('cd "/tmp/Project (draft)"'), "/tmp/Project (draft)")
  assert.equal(explicitCdDirectory('WORKDIR="/tmp/Project (draft)"\ncd "$WORKDIR"'), "/tmp/Project (draft)")
})

test("explicit cd directories reject shell expansions and control syntax", () => {
  for (const command of [
    'cd "$HOME/project"',
    'cd "~/project"',
    'cd "/tmp/project*"',
    'cd "/tmp/{project,other}"',
    'cd "$(printf /tmp/project)"',
    'cd "`printf /tmp/project`"',
    'WORKDIR="${ROOT}/project"\ncd "$WORKDIR"',
    'WORKDIR="/tmp/project*"\ncd "$WORKDIR"',
    'WORKDIR=$(touch${IFS}/tmp/pwn;printf${IFS}.)\ncd "$WORKDIR"',
  ]) {
    assert.equal(explicitCdDirectory(command), undefined, command)
  }
})

test("safe descriptor duplication is separated from named-file redirection", () => {
  assert.equal(commandWithoutSafeDescriptorDuplication("python task.py 2>&1"), "python task.py")
  assert.equal(commandWithoutSafeDescriptorDuplication("python task.py 2>&1 1>&2"), "python task.py")
  assert.equal(
    commandWithoutSafeDescriptorDuplication("python task.py > /tmp/task.log"),
    "python task.py > /tmp/task.log",
  )
  assert.equal(
    commandWithoutSafeDescriptorDuplication("python task.py 2> /tmp/task.log"),
    "python task.py 2> /tmp/task.log",
  )
})

test("parsed command operands exclude redirection syntax and targets", () => {
  assert.deepEqual(
    shellWordsWithoutRedirections(["python", "-m", "pip", "install", "python-docx", ">", "/tmp/install.log", "2>&1"]),
    ["python", "-m", "pip", "install", "python-docx"],
  )
  assert.deepEqual(
    shellWordsWithoutRedirections(["python", "-m", "pip", "install", "python-docx", "2>/tmp/install.log"]),
    ["python", "-m", "pip", "install", "python-docx"],
  )
  assert.deepEqual(shellWordsWithoutRedirections(["python", "-m", "pip", "install", "/tmp/python-docx"]), [
    "python",
    "-m",
    "pip",
    "install",
    "/tmp/python-docx",
  ])
})
