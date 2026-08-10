import type { ChatMessage } from "../../chat/common.ts"

import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../../atomic-file.ts"
import { logDiagnostic } from "../../diagnostics-log.ts"
import { externalSessionUuid } from "./session-id.ts"

// On-disk persistence for external agent transcripts. External agents have no
// queryable server history, so the recorder's flattened snapshot is the only
// record of a session; it is serialized per session (one JSON file, atomic
// replace) and rehydrated lazily after app restarts.

interface TranscriptFile {
  version: 1
  messages: ChatMessage[]
}

export class ExternalTranscriptStore {
  private readonly directory: string

  public constructor(directory: string) {
    this.directory = directory
  }

  public async load(sessionId: string): Promise<ChatMessage[] | undefined> {
    try {
      const raw = await readFile(this.filePath(sessionId), "utf8")
      const parsed = JSON.parse(raw) as TranscriptFile
      if (parsed.version === 1 && Array.isArray(parsed.messages)) {
        return parsed.messages
      }
      logDiagnostic("external-transcript", "unrecognized transcript file shape", { sessionId }, "error")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logDiagnostic("external-transcript", "failed to load transcript", { sessionId, error }, "error")
      }
    }
    return undefined
  }

  public async save(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const payload: TranscriptFile = { version: 1, messages }
    await atomicWriteText(this.filePath(sessionId), JSON.stringify(payload))
  }

  public async remove(sessionId: string): Promise<void> {
    await rm(this.filePath(sessionId), { force: true })
  }

  private filePath(sessionId: string): string {
    const name = externalSessionUuid(sessionId) ?? encodeURIComponent(sessionId)
    return path.join(this.directory, `${name}.json`)
  }
}
