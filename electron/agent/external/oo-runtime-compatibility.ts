import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { EXTERNAL_OO_CONTRACT_VERSION } from "./oo-capability-contract.ts"

export interface OoRuntimeCompatibilityDescriptor {
  contractVersion: number
  files: Record<string, string>
  ooCliVersion: string
}

export interface OoRuntimeCompatibilityResult {
  compatible: boolean
  reason?: string
}

export async function verifyPackagedOoRuntime(resourcesPath: string): Promise<OoRuntimeCompatibilityResult> {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(resourcesPath, "bin", "oo-runtime-compatibility.json"), "utf8"),
    ) as OoRuntimeCompatibilityDescriptor
    if (descriptor.contractVersion !== EXTERNAL_OO_CONTRACT_VERSION) {
      return { compatible: false, reason: "contract_version_mismatch" }
    }
    for (const [relativePath, expected] of Object.entries(descriptor.files)) {
      const content = await readFile(path.join(resourcesPath, "skills", "oo", relativePath))
      const actual = createHash("sha256").update(content).digest("hex")
      if (actual !== expected) return { compatible: false, reason: "skill_hash_mismatch" }
    }
    return { compatible: true }
  } catch {
    return { compatible: false, reason: "descriptor_or_skill_missing" }
  }
}
