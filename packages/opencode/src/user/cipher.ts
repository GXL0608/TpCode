import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import { Flag } from "@/flag/flag"

const local = "tpcode-local-dev-secret"
const legacy = "tpcode-account-dev-secret"

function key(secret: string) {
  return createHash("sha256").update(secret).digest()
}

function ring() {
  return [Flag.TPCODE_ACCOUNT_JWT_SECRET, Flag.OPENCODE_SERVER_PASSWORD, local, legacy].filter(
    (item, i, list): item is string => !!item && list.indexOf(item) === i,
  )
}

function split(input: string) {
  const parts = input.split(".")
  if (parts.length !== 3) return
  const iv = Buffer.from(parts[0], "hex")
  const tag = Buffer.from(parts[1], "hex")
  const data = Buffer.from(parts[2], "base64")
  if (iv.length !== 12 || tag.length !== 16) return
  return { iv, tag, data }
}

function plain(input: string) {
  const body = input.trim()
  if (!body.startsWith("{") && !body.startsWith("[")) return
  try {
    JSON.parse(body)
    return input
  } catch {
    return
  }
}

export namespace UserCipher {
  export function encrypt(input: string) {
    const iv = randomBytes(12)
    const enc = createCipheriv("aes-256-gcm", key(ring()[0] ?? local), iv)
    const body = Buffer.concat([enc.update(input, "utf8"), enc.final()])
    const tag = enc.getAuthTag()
    return [iv.toString("hex"), tag.toString("hex"), body.toString("base64")].join(".")
  }

  export function decrypt(input: string) {
    const parsed = split(input)
    if (!parsed) return
    for (const secret of ring()) {
      try {
        const dec = createDecipheriv("aes-256-gcm", key(secret), parsed.iv)
        dec.setAuthTag(parsed.tag)
        return Buffer.concat([dec.update(parsed.data), dec.final()]).toString("utf8")
      } catch {
        continue
      }
    }
  }

  export function decode(input: string) {
    const secure = decrypt(input)
    if (secure !== undefined) return { raw: secure, encrypted: true as const }
    const raw = plain(input)
    if (raw !== undefined) return { raw, encrypted: false as const }
  }
}
