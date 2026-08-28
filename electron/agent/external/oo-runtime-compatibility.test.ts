import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { OO_CLI_VERSION } from "../oo-version.ts"
import { EXTERNAL_OO_CONTRACT_VERSION } from "./oo-capability-contract.ts"
import { verifyPackagedOoRuntime } from "./oo-runtime-compatibility.ts"

test("verifies the packaged OO descriptor and fails closed on drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-packaged-oo-"))
  try {
    await mkdir(path.join(root, "bin"), { recursive: true })
    await mkdir(path.join(root, "skills", "oo"), { recursive: true })
    const content = "skill"
    await writeFile(path.join(root, "skills", "oo", "SKILL.md"), content)
    await writeFile(
      path.join(root, "bin", "oo-runtime-compatibility.json"),
      JSON.stringify({
        contractVersion: EXTERNAL_OO_CONTRACT_VERSION,
        files: { "SKILL.md": createHash("sha256").update(content).digest("hex") },
        ooCliVersion: OO_CLI_VERSION,
      }),
    )
    await expect(verifyPackagedOoRuntime(root)).resolves.toEqual({ compatible: true })
    await writeFile(
      path.join(root, "bin", "oo-runtime-compatibility.json"),
      JSON.stringify({
        contractVersion: EXTERNAL_OO_CONTRACT_VERSION,
        files: { "SKILL.md": createHash("sha256").update(content).digest("hex") },
        ooCliVersion: "0.0.0",
      }),
    )
    await expect(verifyPackagedOoRuntime(root)).resolves.toEqual({
      compatible: false,
      reason: "oo_cli_version_mismatch",
    })
    await writeFile(
      path.join(root, "bin", "oo-runtime-compatibility.json"),
      JSON.stringify({
        contractVersion: EXTERNAL_OO_CONTRACT_VERSION,
        files: { "SKILL.md": createHash("sha256").update(content).digest("hex") },
        ooCliVersion: OO_CLI_VERSION,
      }),
    )
    await writeFile(path.join(root, "skills", "oo", "SKILL.md"), "tampered")
    await expect(verifyPackagedOoRuntime(root)).resolves.toEqual({
      compatible: false,
      reason: "skill_hash_mismatch",
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
