import { randomBytes } from "node:crypto"

const randomLength = 14
const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastTimestamp = 0
let counter = 0

/** 与锁定版 OpenCode 的 ascending message ID 保持同一排序编码，供 promptAsync 显式绑定消息。 */
export function createOpencodeMessageId(now = Date.now()): string {
  if (now !== lastTimestamp) {
    lastTimestamp = now
    counter = 0
  }
  counter += 1
  const encoded = BigInt(now) * 0x1000n + BigInt(counter)
  const time = Buffer.alloc(6)
  for (let index = 0; index < time.length; index += 1) {
    time[index] = Number((encoded >> BigInt(40 - 8 * index)) & 0xffn)
  }
  const random = randomBytes(randomLength)
  let suffix = ""
  for (const value of random) suffix += base62[value % base62.length]
  return `msg_${time.toString("hex")}${suffix}`
}
