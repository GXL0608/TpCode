import { describe, expect, test } from "bun:test"
import { createUserLayout } from "./settings-users-layout"

describe("createUserLayout", () => {
  test("returns scroll-safe classes for create user dialog and role list", () => {
    const layout = createUserLayout()

    expect(layout.dialog).toContain("max-h-[90vh]")
    expect(layout.body).toContain("overflow-y-auto")
    expect(layout.rolePanel).toContain("max-h-64")
    expect(layout.rolePanel).toContain("overflow-auto")
    expect(layout.roleList).toContain("flex-col")
    expect(layout.roleItem).not.toContain("rounded-full")
  })
})
