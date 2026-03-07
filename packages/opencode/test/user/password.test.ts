import { expect, test } from "bun:test"
import { pbkdf2Sync } from "crypto"
import { UserPassword } from "../../src/user/password"

test("verify supports imported employee password format", async () => {
  const password = "Pass1234"
  const salt = "0123456789abcdef0123456789abcdef"
  const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 1000, 8, "sha1").toString("hex")
  const encoded = UserPassword.encodeEmployee({
    salt,
    hash,
  })
  expect(encoded).toBe(`employee_pbkdf2_sha1$${salt}$${hash}`)
  expect(await UserPassword.verify(password, encoded!)).toBe(true)
  expect(await UserPassword.verify("Pass12345", encoded!)).toBe(false)
})

test("verify keeps Bun password hashes working", async () => {
  const hash = await UserPassword.hash("TpCode@123A")
  expect(await UserPassword.verify("TpCode@123A", hash)).toBe(true)
  expect(await UserPassword.verify("TpCode@123B", hash)).toBe(false)
})
