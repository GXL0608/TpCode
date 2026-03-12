import { describe, expect, test } from "bun:test"
import { HEALTH_POLL_INTERVAL_MS } from "./health-poll"

describe("HEALTH_POLL_INTERVAL_MS", () => {
  test("uses a 30 minute polling interval", () => {
    expect(HEALTH_POLL_INTERVAL_MS).toBe(30 * 60 * 1000)
  })
})
