import { afterEach, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"

const original = process.env["TPCODE_AUTH_BULKHEAD_TIMEOUT_MS"]

afterEach(() => {
  if (original === undefined) {
    delete process.env["TPCODE_AUTH_BULKHEAD_TIMEOUT_MS"]
    return
  }
  process.env["TPCODE_AUTH_BULKHEAD_TIMEOUT_MS"] = original
})

test("reads auth bulkhead timeout from environment", () => {
  process.env["TPCODE_AUTH_BULKHEAD_TIMEOUT_MS"] = "15000"
  expect(Flag.TPCODE_AUTH_BULKHEAD_TIMEOUT_MS).toBe(15000)
})

test("ignores invalid auth bulkhead timeout values", () => {
  process.env["TPCODE_AUTH_BULKHEAD_TIMEOUT_MS"] = "0"
  expect(Flag.TPCODE_AUTH_BULKHEAD_TIMEOUT_MS).toBeUndefined()
})
