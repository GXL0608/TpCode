import { describe, expect, test } from "bun:test"
import { productItemClass, projectsLayoutClass, projectsSolutionLayoutClass, solutionItemClass, syncProductSelection, syncSolutionSelection } from "./settings-projects-view"

const products = [
  {
    id: "product-a",
    solutions: [{ id: "solution-a" }, { id: "solution-b" }],
  },
  {
    id: "product-b",
    solutions: [{ id: "solution-c" }],
  },
]

describe("settings-projects-view", () => {
  test("falls back to the first product when current selection is missing", () => {
    expect(syncProductSelection(products, "")).toBe("product-a")
    expect(syncProductSelection(products, "missing")).toBe("product-a")
    expect(syncProductSelection(products, "product-b")).toBe("product-b")
    expect(syncProductSelection([], "missing")).toBe("")
  })

  test("falls back to the first solution of the current product when selection is missing", () => {
    expect(syncSolutionSelection(products[0], "")).toBe("solution-a")
    expect(syncSolutionSelection(products[0], "missing")).toBe("solution-a")
    expect(syncSolutionSelection(products[0], "solution-b")).toBe("solution-b")
    expect(syncSolutionSelection({ id: "empty", solutions: [] }, "missing")).toBe("")
    expect(syncSolutionSelection(undefined, "missing")).toBe("")
  })

  test("returns highlighted classes for selected product and solution items", () => {
    expect(productItemClass(true)).toContain("border-brand-solid")
    expect(productItemClass(false)).toContain("hover:border-border-weak-base")
    expect(solutionItemClass(true)).toContain("bg-brand-solid/10")
    expect(solutionItemClass(false)).toContain("hover:bg-surface-panel/60")
  })

  test("uses dialog-friendly desktop breakpoints for the products and solutions layout", () => {
    expect(projectsLayoutClass()).toContain("lg:grid-cols-[300px_minmax(0,1fr)]")
    expect(projectsLayoutClass()).not.toContain("xl:grid-cols")
    expect(projectsSolutionLayoutClass()).toContain("lg:grid-cols-[260px_minmax(0,1fr)]")
    expect(projectsSolutionLayoutClass()).not.toContain("xl:grid-cols")
  })
})
