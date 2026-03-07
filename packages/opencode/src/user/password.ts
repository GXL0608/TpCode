import { pbkdf2Sync, timingSafeEqual } from "crypto"

export namespace UserPassword {
  const letter = /[A-Za-z]/
  const digit = /\d/
  const employee = "employee_pbkdf2_sha1"
  const salt = /^[0-9a-f]{32}$/
  const digest = /^[0-9a-f]{16}$/

  function lower(input: string) {
    return input.trim().toLowerCase()
  }

  function employeeHash(input: { password: string; salt: string }) {
    return pbkdf2Sync(input.password, Buffer.from(input.salt, "hex"), 1000, 8, "sha1").toString("hex")
  }

  export function encodeEmployee(input: { salt: string; hash: string }) {
    const next_salt = lower(input.salt)
    const next_hash = lower(input.hash)
    if (!salt.test(next_salt)) return
    if (!digest.test(next_hash)) return
    return `${employee}$${next_salt}$${next_hash}`
  }

  export function decodeEmployee(input: string) {
    if (!input.startsWith(employee + "$")) return
    const parts = input.split("$")
    if (parts.length !== 3) return null
    const next_salt = lower(parts[1] ?? "")
    const next_hash = lower(parts[2] ?? "")
    if (!salt.test(next_salt)) return null
    if (!digest.test(next_hash)) return null
    return {
      salt: next_salt,
      hash: next_hash,
    }
  }

  export async function hash(input: string) {
    return Bun.password.hash(input)
  }

  export async function verify(input: string, hash: string) {
    if (hash.startsWith(employee + "$")) {
      const item = decodeEmployee(hash)
      if (!item) return false
      const value = employeeHash({
        password: input,
        salt: item.salt,
      })
      const left = Buffer.from(value, "utf8")
      const right = Buffer.from(item.hash, "utf8")
      if (left.length !== right.length) return false
      return timingSafeEqual(left, right)
    }
    return Bun.password.verify(input, hash)
  }

  export function valid(input: string) {
    if (input.length < 8) return false
    if (!letter.test(input)) return false
    if (!digit.test(input)) return false
    return true
  }
}
