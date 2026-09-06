import type { LocalArtifactArchivePreview } from "./common.ts"
import type { FileHandle } from "node:fs/promises"

import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"
import { Parser } from "tar"
import {
  archivePreviewMaxEntries,
  archivePreviewMaxScanBytes,
  archivePreviewMaxTimeMs,
} from "./archive-preview-limits.ts"

export async function readTarPreview(
  handle: FileHandle,
  options: { signal?: AbortSignal; maxScanBytes?: number; maxTimeMs?: number } = {},
): Promise<LocalArtifactArchivePreview> {
  options.signal?.throwIfAborted()
  const entries: LocalArtifactArchivePreview["entries"] = []
  const budgetError = new Error("Archive preview budget reached")
  let stopped = false
  let parseError: Error | undefined
  const controller = new AbortController()
  const stop = () => {
    stopped = true
    parser.abort(budgetError)
    controller.abort(budgetError)
  }
  const parser = new Parser({
    strict: true,
    brotli: false,
    zstd: false,
    maxMetaEntrySize: 4096,
    onReadEntry(entry) {
      entries.push({
        kind: entry.type === "Directory" ? "directory" : "file",
        path: entry.path,
        size: entry.size,
        modifiedAt: entry.mtime?.getTime(),
      })
      entry.resume()
      if (entries.length >= archivePreviewMaxEntries) stop()
    },
  })
  parser.on("error", (error: Error) => {
    parseError = error
  })
  // Do not silently discard oversized PAX / GNU path metadata and show a false filename.
  parser.on("ignoredEntry", stop)
  const maxTimeMs = options.maxTimeMs ?? archivePreviewMaxTimeMs
  const deadline = performance.now() + maxTimeMs
  const timer = setTimeout(stop, maxTimeMs)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  let scanned = 0
  const maxScanBytes = options.maxScanBytes ?? archivePreviewMaxScanBytes
  let prefix: Buffer | undefined
  let checkedPrefix = false
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (performance.now() >= deadline && !stopped) stop()
      if (stopped) return callback(budgetError)
      // Parser auto-inflates gzip internally. Reject nested compression so every
      // decompressed byte passes through the external, asynchronous zlib budget.
      if (!checkedPrefix) {
        if (prefix) chunk = Buffer.concat([prefix, chunk])
        if (chunk.length < 2) {
          prefix = chunk
          return callback()
        }
        checkedPrefix = true
        prefix = undefined
        if (chunk[0] === 0x1f && chunk[1] === 0x8b) return callback(new Error("Nested gzip is not a TAR archive"))
      }
      const allowed = Math.min(chunk.length, Math.max(0, maxScanBytes - scanned))
      if (allowed) parser.write(chunk.subarray(0, allowed))
      scanned += allowed
      if (!stopped && scanned >= maxScanBytes) stop()
      callback(stopped ? budgetError : parseError)
    },
    final(callback) {
      if (prefix) parser.write(prefix)
      parser.end()
      callback(parseError)
    },
  })
  try {
    const magic = Buffer.alloc(2)
    await handle.read(magic, 0, 2, 0)
    const source = handle.createReadStream({ start: 0, autoClose: false, highWaterMark: 16 * 1024 })
    if (magic[0] === 0x1f && magic[1] === 0x8b) {
      // Native asynchronous zlib keeps inflation out of the main JS thread; budget counts its output.
      await pipeline(source, createGunzip({ chunkSize: 16 * 1024 }), sink, { signal })
    } else {
      await pipeline(source, sink, { signal })
    }
  } catch (error) {
    options.signal?.throwIfAborted()
    if (!stopped) throw error
  } finally {
    clearTimeout(timer)
  }
  return { entries, format: "tar", totalEntries: stopped ? null : entries.length }
}
