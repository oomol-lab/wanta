import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { spaceSchema } from "./spaces-client.ts"

const recordSchema = z.object({
  key: z.string(),
  createdAt: z.number(),
  status: z.enum(["prepared", "submitted", "completed"]),
  fingerprint: z.string(),
  space: spaceSchema.optional(),
  jobId: z.string().optional(),
})
export type SpacesOperation = z.infer<typeof recordSchema>

/** Host-private recovery journal. Never contains login or deployment credentials. */
export class SpacesOperationStore {
  private readonly root: string
  public constructor(root: string) {
    this.root = root
  }

  public async read(id: string): Promise<SpacesOperation | null> {
    try {
      return recordSchema.parse(JSON.parse(await readFile(this.filename(id), "utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw new Error("Spaces operation journal is unreadable; refusing to repeat an uncertain operation.")
    }
  }

  public async write(id: string, value: SpacesOperation): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const file = this.filename(id)
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(recordSchema.parse(value)), { mode: 0o600 })
    await rename(temporary, file)
  }

  private filename(id: string): string {
    return path.join(this.root, `${spacesDigest(id)}.json`)
  }
}

export function spacesDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
