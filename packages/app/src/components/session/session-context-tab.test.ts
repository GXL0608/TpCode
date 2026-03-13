import { describe, expect, test } from "bun:test"
import { canViewSessionRawMessages } from "./session-context-tab-access"

describe("canViewSessionRawMessages", () => {
  test("allows super admin to view raw messages", () => {
    expect(canViewSessionRawMessages(["super_admin"])).toBe(true)
  })

  test("blocks non super admin roles from viewing raw messages", () => {
    expect(canViewSessionRawMessages(["developer"])).toBe(false)
    expect(canViewSessionRawMessages(["reviewer"])).toBe(false)
    expect(canViewSessionRawMessages(["user"])).toBe(false)
  })

  test("blocks empty or missing roles from viewing raw messages", () => {
    expect(canViewSessionRawMessages()).toBe(false)
    expect(canViewSessionRawMessages([])).toBe(false)
  })
})
