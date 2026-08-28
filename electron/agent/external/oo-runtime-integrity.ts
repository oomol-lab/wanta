import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { OO_CLI_VERSION } from "../oo-version.ts"
import { EXTERNAL_OO_CONTRACT_VERSION } from "./oo-capability-contract.ts"

export interface OoRuntimeIntegrityDescriptor {
  contractVersion: number
  files: Record<string, string>
  ooCliVersion: string
}

export interface OoRuntimeIntegrityResult {
  available: boolean
  reason?: string
}

export async function verifyPackagedOoRuntimeIntegrity(resourcesPath: string): Promise<OoRuntimeIntegrityResult> {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(resourcesPath, "bin", "oo-runtime-integrity.json"), "utf8"),
    ) as OoRuntimeIntegrityDescriptor
    if (descriptor.contractVersion !== EXTERNAL_OO_CONTRACT_VERSION) {
      return { available: false, reason: "contract_version_mismatch" }
    }
    if (descriptor.ooCliVersion !== OO_CLI_VERSION) {
      return { available: false, reason: "oo_cli_version_mismatch" }
    }
    for (const [relativePath, expected] of Object.entries(descriptor.files)) {
      const content = await readFile(path.join(resourcesPath, "skills", "oo", relativePath))
      const actual = createHash("sha256").update(content).digest("hex")
      if (actual !== expected) return { available: false, reason: "skill_hash_mismatch" }
    }
    return { available: true }
  } catch {
    return { available: false, reason: "descriptor_or_skill_missing" }
  }
}
