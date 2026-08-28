import { readFile } from "node:fs/promises"
import path from "node:path"
import { EXTERNAL_OO_OPERATIONS } from "../electron/agent/external/oo-capability-contract.ts"
import { OO_CLI_VERSION } from "./oo-cli.ts"
import { skillLockDir, verifyBundledOoSkillLock } from "./skills.ts"

interface OoSkillLock {
  agentFormat: string
  lockVersion: number
  ooCliVersion: string
  requiredOperations: string[]
}

const lockPath = path.join(skillLockDir, "oo.json")
await verifyBundledOoSkillLock()
const lock = JSON.parse(await readFile(lockPath, "utf8")) as OoSkillLock
const operations = new Map(EXTERNAL_OO_OPERATIONS.map((operation) => [operation.id, operation.availability]))

process.stdout.write(`OO bundle verified: ${OO_CLI_VERSION}/${lock.agentFormat}, lock v${lock.lockVersion}\n`)
for (const operation of lock.requiredOperations) {
  process.stdout.write(`- ${operation}: ${operations.get(operation)}\n`)
}
