import assert from "node:assert/strict"
import { test } from "vitest"
import { explicitCdDirectory } from "./shell-syntax.ts"

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
