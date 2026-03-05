import { afterEach, expect, test } from "bun:test"
import { createCipheriv, createHash, randomBytes } from "crypto"
import { UserCipher } from "../../src/user/cipher"

const jwt = process.env["TPCODE_ACCOUNT_JWT_SECRET"]
const server = process.env["OPENCODE_SERVER_PASSWORD"]

function restore() {
  if (jwt === undefined) delete process.env["TPCODE_ACCOUNT_JWT_SECRET"]
  if (jwt !== undefined) process.env["TPCODE_ACCOUNT_JWT_SECRET"] = jwt
  if (server === undefined) delete process.env["OPENCODE_SERVER_PASSWORD"]
  if (server !== undefined) process.env["OPENCODE_SERVER_PASSWORD"] = server
}

function seal(input: string, secret: string) {
  const iv = randomBytes(12)
  const enc = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  const body = Buffer.concat([enc.update(input, "utf8"), enc.final()])
  const tag = enc.getAuthTag()
  return [iv.toString("hex"), tag.toString("hex"), body.toString("base64")].join(".")
}

afterEach(restore)

test("decrypt supports env secret", () => {
  process.env["TPCODE_ACCOUNT_JWT_SECRET"] = "tpcode-jwt-secret"
  delete process.env["OPENCODE_SERVER_PASSWORD"]
  const raw = JSON.stringify({ type: "api", key: "sk-env" })
  const cipher = UserCipher.encrypt(raw)
  expect(UserCipher.decrypt(cipher)).toBe(raw)
})

test("decrypt supports local default secret when env missing", () => {
  delete process.env["TPCODE_ACCOUNT_JWT_SECRET"]
  delete process.env["OPENCODE_SERVER_PASSWORD"]
  const raw = JSON.stringify({ type: "api", key: "sk-default" })
  const cipher = UserCipher.encrypt(raw)
  expect(UserCipher.decrypt(cipher)).toBe(raw)
})

test("decrypt supports legacy default secret", () => {
  delete process.env["TPCODE_ACCOUNT_JWT_SECRET"]
  delete process.env["OPENCODE_SERVER_PASSWORD"]
  const raw = JSON.stringify({ type: "api", key: "sk-legacy" })
  const cipher = seal(raw, "tpcode-account-dev-secret")
  expect(UserCipher.decrypt(cipher)).toBe(raw)
})
