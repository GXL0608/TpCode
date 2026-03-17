import { describe, expect, test } from "bun:test"
import { codingTimeout } from "../../src/build/timeout"

describe("codingTimeout", () => {
  test("uses 10 minutes when env is missing", () => {
    expect(codingTimeout()).toBe(600000)
  })

  test("falls back to 10 minutes when env is invalid", () => {
    expect(codingTimeout("abc")).toBe(600000)
    expect(codingTimeout("0")).toBe(600000)
    expect(codingTimeout("-1")).toBe(600000)
  })

  test("keeps a valid explicit timeout", () => {
    expect(codingTimeout("18000")).toBe(18000)
  })
})
