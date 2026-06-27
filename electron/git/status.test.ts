import assert from "node:assert/strict"
import { test } from "vitest"
import {
  classifyGitError,
  normalizeCheckoutBranchName,
  parseBranchList,
  parsePorcelainStatus,
  readGitRepositoryState,
} from "./status.ts"

test("parsePorcelainStatus counts staged, unstaged, and untracked files", () => {
  assert.deepEqual(parsePorcelainStatus(["## main", " M src/app.ts", "A  electron/git.ts", "?? notes.md"].join("\n")), {
    dirty: true,
    stagedCount: 1,
    unstagedCount: 1,
    untrackedCount: 1,
  })
})

test("parseBranchList sorts current and local branches first", () => {
  assert.deepEqual(
    parseBranchList(
      [
        "refs/heads/main\u0000main\u0000origin/main",
        "refs/heads/feature/git-ui\u0000feature/git-ui\u0000",
        "refs/remotes/origin/main\u0000origin/main\u0000",
      ].join("\n"),
      "main",
    ),
    [
      { name: "main", current: true, remote: false, upstream: "origin/main" },
      { name: "feature/git-ui", current: false, remote: false },
    ],
  )
})

test("normalizeCheckoutBranchName rejects empty and shell-like branch names", () => {
  assert.equal(normalizeCheckoutBranchName(" feature/git-ui "), "feature/git-ui")
  assert.equal(normalizeCheckoutBranchName(""), null)
  assert.equal(normalizeCheckoutBranchName("-bad"), null)
  assert.equal(normalizeCheckoutBranchName("bad..name"), null)
})

test("classifyGitError recognizes common local repository failures", () => {
  assert.deepEqual(classifyGitError({ code: "ENOENT", message: "spawn git ENOENT" }), {
    error: "git_unavailable",
    message: "Git executable was not found.",
  })
  assert.deepEqual(classifyGitError({ message: "fatal", stderr: "fatal: not a git repository" }), {
    error: "not_repository",
    message: "fatal: not a git repository",
  })
})

test("readGitRepositoryState composes repository state from git commands", async () => {
  const calls: string[][] = []
  const state = await readGitRepositoryState("project", "/repo", async (args) => {
    calls.push(args)
    const command = args.slice(2).join(" ")
    if (command === "rev-parse --show-toplevel") {
      return { stdout: "/repo\n", stderr: "" }
    }
    if (command === "branch --show-current") {
      return { stdout: "main\n", stderr: "" }
    }
    if (command === "rev-parse --short HEAD") {
      return { stdout: "abc123\n", stderr: "" }
    }
    if (command.startsWith("for-each-ref")) {
      return {
        stdout: "refs/heads/main\u0000main\u0000origin/main\nrefs/heads/feature\u0000feature\u0000\n",
        stderr: "",
      }
    }
    if (command === "status --porcelain=v1 --branch") {
      return { stdout: "## main\n M package.json\n", stderr: "" }
    }
    return { stdout: "", stderr: "" }
  })

  assert.equal(calls.length, 5)
  assert.deepEqual(state, {
    projectId: "project",
    projectPath: "/repo",
    available: true,
    repositoryRoot: "/repo",
    currentBranch: "main",
    branches: [
      { name: "main", current: true, remote: false, upstream: "origin/main" },
      { name: "feature", current: false, remote: false },
    ],
    dirty: true,
    stagedCount: 0,
    unstagedCount: 1,
    untrackedCount: 0,
  })
})

test("readGitRepositoryState reports unavailable when status subcommands fail", async () => {
  const calls: string[][] = []
  const state = await readGitRepositoryState("project", "/repo", async (args) => {
    calls.push(args)
    const command = args.slice(2).join(" ")
    if (command === "rev-parse --show-toplevel") {
      return { stdout: "/repo\n", stderr: "" }
    }
    if (command === "status --porcelain=v1 --branch") {
      throw { message: "fatal", stderr: "fatal: bad revision", code: 128 }
    }
    return { stdout: "", stderr: "" }
  })

  assert.deepEqual(state, {
    projectId: "project",
    projectPath: "/repo",
    available: false,
    repositoryRoot: "/repo",
    branches: [],
    dirty: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    error: "unknown",
    message: "fatal: bad revision",
  })
  const commands = calls.map((args) => args.slice(2).join(" "))
  assert.equal(commands[0], "rev-parse --show-toplevel")
  assert.ok(commands.slice(1).includes("status --porcelain=v1 --branch"))
})
