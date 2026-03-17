import { describe, expect, test } from "bun:test"
import { shouldAlignDirectoryProjectContext } from "./directory-layout-helpers"

describe("shouldAlignDirectoryProjectContext", () => {
  test("产品上下文下不再强制项目对齐", () => {
    expect(
      shouldAlignDirectoryProjectContext({
        authenticated: true,
        global_ready: true,
        directory: "/workspace/build-overlay/product",
        context_product_id: "product_1",
        target_project_id: "project_a",
        current_project_id: "project_b",
      }),
    ).toBe(false)
  })

  test("普通项目上下文且项目不一致时仍需对齐", () => {
    expect(
      shouldAlignDirectoryProjectContext({
        authenticated: true,
        global_ready: true,
        directory: "/workspace/project",
        target_project_id: "project_a",
        current_project_id: "project_b",
      }),
    ).toBe(true)
  })

  test("当前已对齐时不重复触发", () => {
    expect(
      shouldAlignDirectoryProjectContext({
        authenticated: true,
        global_ready: true,
        directory: "/workspace/project",
        target_project_id: "project_a",
        current_project_id: "project_a",
      }),
    ).toBe(false)
  })
})
