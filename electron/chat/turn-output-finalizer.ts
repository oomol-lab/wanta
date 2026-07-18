import type { ArtifactBundle, ChatMessage } from "./common.ts"
import type { ActiveTurnOutput } from "./turn-output-registry.ts"
import type { StoredTurnOutputRecord } from "./turn-outputs.ts"

import { rm } from "node:fs/promises"
import { managedPythonEnvironmentPath } from "../agent/python-environment.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import {
  buildArtifactBundle,
  generatedImagePreviewCount,
  materializeAssistantArtifacts,
  recoverMisplacedTurnArtifacts,
} from "./artifact-bundles.ts"
import {
  boundTurnOutputPatchPayloads,
  intermediateArtifactProcessFiles,
  processOutputFiles,
  projectOutputFiles,
  summarizeTurnFiles,
} from "./turn-output-files.ts"

export async function finalizeTurnOutput(options: {
  active: ActiveTurnOutput
  getMessages: () => Promise<ChatMessage[]>
  messageId: string
  publishArtifactBundle: (bundle: ArtifactBundle) => Promise<void>
  publishTurnOutput: (record: StoredTurnOutputRecord) => Promise<void>
  sessionId: string
}): Promise<void> {
  const { active, messageId, sessionId } = options
  try {
    const messages = await options.getMessages().catch(() => [])
    const materializedOrigins = await materializeAssistantArtifacts(messages, messageId, active.artifactRoot).catch(
      (error: unknown) => {
        console.warn("[wanta] failed to materialize assistant artifacts", error)
        logDiagnostic(
          "chat-service",
          "failed to materialize assistant artifacts",
          { error, messageId, sessionId },
          "warn",
        )
        return new Map()
      },
    )
    const recoveredOrigins = await recoverMisplacedTurnArtifacts(active.artifactBaseline, active.artifactRoot).catch(
      (error: unknown) => {
        console.warn("[wanta] failed to recover misplaced turn artifacts", error)
        logDiagnostic(
          "chat-service",
          "failed to recover misplaced turn artifacts",
          { error, messageId, sessionId },
          "warn",
        )
        return new Map()
      },
    )
    for (const [relativePath, origin] of recoveredOrigins) materializedOrigins.set(relativePath, origin)

    const completedAt = Date.now()
    const intermediateArtifactFiles = await intermediateArtifactProcessFiles(active.artifactRoot, active.requestText)
    const [artifactBundle, processFiles, projectFiles] = await Promise.all([
      buildArtifactBundle({
        artifactRoot: active.artifactRoot,
        completedAt,
        createdAt: active.createdAt,
        excludedPaths: new Set(intermediateArtifactFiles.map((file) => file.path)),
        generatedPreviewCount: generatedImagePreviewCount(messages, messageId),
        materializedOrigins,
        messageId,
        sessionId,
      }),
      processOutputFiles(active.processRoot),
      projectOutputFiles(active.projectBaseline, active.projectRoot),
    ])
    if (artifactBundle) await options.publishArtifactBundle(artifactBundle)

    const files = boundTurnOutputPatchPayloads([...processFiles, ...intermediateArtifactFiles, ...projectFiles])
    if (files.length === 0) return
    await options.publishTurnOutput({
      sessionId,
      messageId,
      processRoot: active.processRoot,
      ...(active.projectRoot ? { projectRoot: active.projectRoot } : {}),
      createdAt: active.createdAt,
      completedAt,
      files,
      summary: summarizeTurnFiles(files),
    })
  } finally {
    await rm(managedPythonEnvironmentPath(active.processRoot), { force: true, recursive: true }).catch(() => undefined)
  }
}
