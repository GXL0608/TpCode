import { describe, expect, test } from "bun:test"
import { createUserLayout } from "./settings-users-layout"

describe("createUserLayout", () => {
  test("returns scroll-safe classes for create user dialog and dropdown role picker", () => {
    const layout = createUserLayout()

    expect(layout.dialog).toContain("max-h-[90vh]")
    expect(layout.body).toContain("overflow-y-auto")
    expect(layout.roleTrigger).toContain("w-full")
    expect(layout.rolePanel).toContain("w-[min(32rem,calc(100vw-2rem))]")
    expect(layout.rolePanel).toContain("overflow-hidden")
    expect(layout.roleSearch).toContain("border-b")
    expect(layout.roleList).toContain("max-h-[min(40vh,320px)]")
    expect(layout.roleList).toContain("overflow-auto")
    expect(layout.roleFooter).toContain("justify-between")
    expect(layout.roleItem).toContain("justify-between")
  })
})
