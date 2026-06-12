import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "vitest"
import {
  detectLinuxLibc,
  extractFileFromTar,
  ooExecutableName,
  resolvePlatformTarget,
  verifyTarballIntegrity,
} from "./oo-cli.ts"

// ── 构造最小 ustar 归档（用于 extractFileFromTar 测试）─────────────────────────────

/** 定长八进制字段：len-1 位八进制 + NUL。 */
function octalField(value: number, len: number): string {
  return `${value.toString(8).padStart(len - 1, "0")}\0`
}

/** 生成一个 512 字节 ustar header（含正确 checksum，尽管解析器不校验）。 */
function tarHeader(name: string, size: number, typeflag: string, prefix = ""): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, "utf-8") // name @0 (100)
  header.write("0000644\0", 100, "utf-8") // mode
  header.write(octalField(size, 12), 124, "utf-8") // size @124 (12)
  header.write(octalField(0, 12), 136, "utf-8") // mtime
  header.write(typeflag, 156, "utf-8") // typeflag @156
  header.write("ustar\0", 257, "utf-8") // magic
  header.write("00", 263, "utf-8") // version
  if (prefix) {
    header.write(prefix, 345, "utf-8") // prefix @345 (155)
  }
  // checksum @148 (8)：先填 8 个空格算和，再写 6 位八进制 + NUL + space。
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20
  }
  let sum = 0
  for (let i = 0; i < 512; i++) {
    sum += header[i] ?? 0
  }
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf-8")
  return header
}

/** 一条完整记录：header + 512 对齐的数据块。 */
function tarEntry(name: string, content: Buffer, typeflag = "0", prefix = ""): Buffer {
  const data = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  content.copy(data)
  return Buffer.concat([tarHeader(name, content.length, typeflag, prefix), data])
}

const TAR_END = Buffer.alloc(1024) // 两个全零块标志归档结束

test("extractFileFromTar 命中目标普通文件，跳过同名 pax 扩展头与无关条目", () => {
  const tar = Buffer.concat([
    tarEntry("package/other.txt", Buffer.from("decoy-content")),
    tarEntry("package/bin/oo", Buffer.from("PAX-JUNK"), "x"), // pax 扩展头：同名但 typeflag=x，应跳过
    tarEntry("package/bin/oo", Buffer.from("REAL-OO-BINARY"), "0"),
    TAR_END,
  ])
  assert.deepEqual(extractFileFromTar(tar, "package/bin/oo"), Buffer.from("REAL-OO-BINARY"))
})

test("extractFileFromTar 支持 ustar prefix 拼接长路径", () => {
  const tar = Buffer.concat([tarEntry("oo", Buffer.from("PREFIXED"), "0", "package/bin"), TAR_END])
  assert.deepEqual(extractFileFromTar(tar, "package/bin/oo"), Buffer.from("PREFIXED"))
})

test("extractFileFromTar 未命中返回 null", () => {
  const tar = Buffer.concat([tarEntry("package/bin/oo", Buffer.from("X")), TAR_END])
  assert.equal(extractFileFromTar(tar, "package/bin/missing"), null)
})

test("extractFileFromTar 对声明 size 越界的截断归档抛错（不静默返回半截）", () => {
  // header 声明 5000 字节，但其后没有足量数据。
  const truncated = Buffer.concat([tarHeader("package/bin/oo", 5000, "0"), Buffer.alloc(100)])
  assert.throws(() => extractFileFromTar(truncated, "package/bin/oo"), /truncated tar/)
})

// ── 平台映射 ─────────────────────────────────────────────────────────────────────

test("resolvePlatformTarget 覆盖全部 8 个平台/架构（Linux 含 libc）", () => {
  const cases: Array<[NodeJS.Platform, string, "glibc" | "musl", string, string]> = [
    ["darwin", "arm64", "glibc", "@oomol-lab/oo-cli-darwin-arm64", "oo"],
    ["darwin", "x64", "glibc", "@oomol-lab/oo-cli-darwin-x64", "oo"],
    ["win32", "arm64", "glibc", "@oomol-lab/oo-cli-win32-arm64", "oo.exe"],
    ["win32", "x64", "glibc", "@oomol-lab/oo-cli-win32-x64", "oo.exe"],
    ["linux", "arm64", "glibc", "@oomol-lab/oo-cli-linux-arm64-gnu", "oo"],
    ["linux", "arm64", "musl", "@oomol-lab/oo-cli-linux-arm64-musl", "oo"],
    ["linux", "x64", "glibc", "@oomol-lab/oo-cli-linux-x64-gnu", "oo"],
    ["linux", "x64", "musl", "@oomol-lab/oo-cli-linux-x64-musl", "oo"],
  ]
  for (const [platform, arch, libc, packageName, executableFileName] of cases) {
    assert.deepEqual(resolvePlatformTarget(platform, arch, libc), { packageName, executableFileName })
  }
})

test("resolvePlatformTarget 对不支持的平台/架构抛错", () => {
  assert.throws(() => resolvePlatformTarget("sunos" as NodeJS.Platform, "x64"), /No prebuilt oo binary/)
  assert.throws(() => resolvePlatformTarget("darwin", "ia32"), /No prebuilt oo binary/)
})

test("ooExecutableName 仅 Windows 带 .exe", () => {
  assert.equal(ooExecutableName("darwin"), "oo")
  assert.equal(ooExecutableName("linux"), "oo")
  assert.equal(ooExecutableName("win32"), "oo.exe")
})

// ── libc 判别 ─────────────────────────────────────────────────────────────────────

test("detectLinuxLibc：有 glibcVersionRuntime → glibc，否则 musl", () => {
  assert.equal(detectLinuxLibc({ header: { glibcVersionRuntime: "2.31" } }), "glibc")
  assert.equal(detectLinuxLibc({ header: { glibcVersionRuntime: "" } }), "musl")
  assert.equal(detectLinuxLibc({ header: {} }), "musl")
  assert.equal(detectLinuxLibc({}), "musl")
})

// ── tarball 完整性校验（SRI）────────────────────────────────────────────────────

test("verifyTarballIntegrity：sha512 匹配放行、不匹配抛错、不支持算法抛错", () => {
  const tgz = Buffer.from("pretend-this-is-a-tarball")
  const sha512 = createHash("sha512").update(tgz).digest("base64")
  // 匹配：不抛错。
  assert.doesNotThrow(() => verifyTarballIntegrity(tgz, `sha512-${sha512}`, "test"))
  // 多算法空格分隔时仍取 sha512。
  assert.doesNotThrow(() => verifyTarballIntegrity(tgz, `sha1-AAAA sha512-${sha512}`, "test"))
  // 不匹配：抛错（证明确实在比对，而非空操作）。
  assert.throws(() => verifyTarballIntegrity(tgz, "sha512-AAAAAAAAAAAAAAAAAAAAAA==", "test"), /integrity mismatch/)
  // 篡改内容后同一 SRI 不再匹配。
  assert.throws(() => verifyTarballIntegrity(Buffer.from("tampered"), `sha512-${sha512}`, "test"), /integrity mismatch/)
  // 仅 sha256（无 sha512）：不支持。
  assert.throws(() => verifyTarballIntegrity(tgz, "sha256-AAAA", "test"), /unsupported integrity/)
})
