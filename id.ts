import { randomBytes } from "crypto"

const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let last = 0
let count = 0

function rnd(len: number) {
  let out = ""
  const buf = randomBytes(len)
  for (let i = 0; i < len; i++) out += chars[(buf[i] ?? 0) % 62]
  return out
}

export function mid() {
  const now = Date.now()
  if (now !== last) {
    last = now
    count = 0
  }
  count += 1

  const id = BigInt(now) * BigInt(0x1000) + BigInt(count)
  const buf = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) buf[i] = Number((id >> BigInt(40 - 8 * i)) & BigInt(0xff))
  return `msg_${buf.toString("hex")}${rnd(14)}`
}
