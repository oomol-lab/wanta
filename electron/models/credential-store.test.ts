import assert from "node:assert/strict"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ModelCredentialStore, ModelCredentialUnavailableError } from "./credential-store.ts"

function encryption(options: { available?: boolean; backend?: string } = {}) {
  return {
    decryptString: (encrypted: Buffer) => Buffer.from(encrypted.toString("utf8"), "base64").toString("utf8"),
    encryptString: (plainText: string) => Buffer.from(Buffer.from(plainText, "utf8").toString("base64"), "utf8"),
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    isEncryptionAvailable: () => options.available ?? true,
  }
}

test("ModelCredentialStore persists only encrypted API keys with owner-only permissions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-model-credentials-"))
  const store = new ModelCredentialStore(dir, encryption(), "darwin")

  await store.set("model-1", "sk-secret")

  assert.equal(await store.get("model-1"), "sk-secret")
  const file = path.join(dir, "model-credentials.json")
  assert.equal((await readFile(file, "utf8")).includes("sk-secret"), false)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test("ModelCredentialStore deletes only the requested credential", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-model-credentials-"))
  const store = new ModelCredentialStore(dir, encryption(), "darwin")
  await store.setMany(
    new Map([
      ["model-1", "first-secret"],
      ["model-2", "second-secret"],
    ]),
  )

  await store.delete("model-1")

  assert.equal(await store.get("model-1"), undefined)
  assert.equal(await store.get("model-2"), "second-secret")
})

test("ModelCredentialStore refuses unavailable and Linux plaintext backends", async () => {
  const unavailable = new ModelCredentialStore(
    await mkdtemp(path.join(tmpdir(), "wanta-model-credentials-")),
    encryption({ available: false }),
    "darwin",
  )
  await assert.rejects(unavailable.set("model-1", "secret"), ModelCredentialUnavailableError)

  const linuxPlaintext = new ModelCredentialStore(
    await mkdtemp(path.join(tmpdir(), "wanta-model-credentials-")),
    encryption({ backend: "basic_text" }),
    "linux",
  )
  await assert.rejects(linuxPlaintext.set("model-1", "secret"), /plaintext fallback is disabled/i)
})
