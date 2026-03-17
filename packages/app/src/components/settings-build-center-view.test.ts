import { describe, expect, test } from "bun:test"
import { resolveBuildCenterProducts, syncBuildCenterFilters } from "./settings-build-center-view"

const products = [
  {
    id: "product-a",
    name: "CSHIS",
    solutions: [
      { id: "solution-a1", enabled: true },
      { id: "solution-a2", enabled: true },
    ],
  },
  {
    id: "product-b",
    name: "慢病管理系统",
    solutions: [{ id: "solution-b1", enabled: true }],
  },
]

describe("settings-build-center-view", () => {
  test("keeps the current products during filter-only reloads to avoid resetting the dropdown", () => {
    expect(resolveBuildCenterProducts(products, [{ id: "server-copy", name: "server-copy", solutions: [] }], false)).toEqual(products)
    expect(resolveBuildCenterProducts([], products, false)).toEqual(products)
    expect(resolveBuildCenterProducts(products, [{ id: "server-copy", name: "server-copy", solutions: [] }], true)).toEqual([
      { id: "server-copy", name: "server-copy", solutions: [] },
    ])
  })

  test("filters soft-deleted products from the build center dropdown", () => {
    expect(
      resolveBuildCenterProducts(
        [],
        [
          { id: "product-a", name: "CSHIS", solutions: [] },
          { id: "product-b", name: "删-测试产品", solutions: [] },
        ],
        true,
      ),
    ).toEqual([{ id: "product-a", name: "CSHIS", solutions: [] }])
  })

  test("keeps the explicitly selected product instead of always falling back to the first item", () => {
    expect(syncBuildCenterFilters(products, "product-b", "")).toEqual({
      product_id: "product-b",
      solution_id: "",
    })
  })

  test("falls back to the first product only when the current selection is missing", () => {
    expect(syncBuildCenterFilters(products, "", "")).toEqual({
      product_id: "product-a",
      solution_id: "",
    })
    expect(syncBuildCenterFilters(products, "missing", "")).toEqual({
      product_id: "product-a",
      solution_id: "",
    })
  })

  test("clears an invalid solution when switching to another product", () => {
    expect(syncBuildCenterFilters(products, "product-b", "solution-a1")).toEqual({
      product_id: "product-b",
      solution_id: "",
    })
    expect(syncBuildCenterFilters(products, "product-a", "solution-a2")).toEqual({
      product_id: "product-a",
      solution_id: "solution-a2",
    })
  })
})
