import { describe, expect, test } from "bun:test"
import { defaultSettings } from "./settings"

describe("settings defaults", () => {
  test("shows reasoning summaries by default", () => {
    expect(defaultSettings.general.showReasoningSummaries).toBe(true)
  })
})
