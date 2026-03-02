import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import { Flag } from "@/flag/flag"

function key() {
  const secret = Flag.TPCODE_ACCOUNT_JWT_SECRET ?? Flag.OPENCODE_SERVER_PASSWORD ?? "tpcode-account-dev-secret"
  return createHash("sha256").update(secret).digest()
}

export namespace UserCipher {
  export function encrypt(input: string) {
    const iv = randomBytes(12)
    const enc = createCipheriv("aes-256-gcm", key(), iv)
    const body = Buffer.concat([enc.update(input, "utf8"), enc.final()])
    const tag = enc.getAuthTag()
    return [iv.toString("hex"), tag.toString("hex"), body.toString("base64")].join(".")
  }

  export function decrypt(input: string) {
    const parts = input.split(".")
    if (parts.length !== 3) return
    const iv = Buffer.from(parts[0], "hex")
    const tag = Buffer.from(parts[1], "hex")
    const data = Buffer.from(parts[2], "base64")
    try {
      const dec = createDecipheriv("aes-256-gcm", key(), iv)
      dec.setAuthTag(tag)
      return Buffer.concat([dec.update(data), dec.final()]).toString("utf8")
    } catch {
      return
    }
  }
}
