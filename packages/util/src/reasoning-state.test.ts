import { describe, expect, test } from "bun:test"
import { resolveReasoningLabel, resolveReasoningOpen, setReasoningManual } from "./reasoning-state"

describe("reasoning state", () => {
  test("opens by default while reasoning is active", () => {
    expect(resolveReasoningOpen(undefined, true)).toBe(true)
  })

  test("collapses by default after reasoning completes", () => {
    expect(resolveReasoningOpen(undefined, false)).toBe(false)
  })

  test("keeps manual collapse while reasoning is active", () => {
    expect(resolveReasoningOpen(setReasoningManual(false), true)).toBe(false)
  })

  test("keeps manual expand after reasoning completes", () => {
    expect(resolveReasoningOpen(setReasoningManual(true), false)).toBe(true)
  })

  test("uses completed label after reasoning finishes", () => {
    expect(resolveReasoningLabel(false)).toBe("completed")
  })
})
