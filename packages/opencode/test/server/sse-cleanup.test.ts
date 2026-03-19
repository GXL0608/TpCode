import { describe, expect, test } from "bun:test"
import { createSSECleanup } from "../../src/server/sse-cleanup"

describe("sse cleanup", () => {
  test("close 和 abort 重复触发时只清理一次", () => {
    const calls: string[] = []
    const cleanup = createSSECleanup({
      onClosed() {
        calls.push("closed")
      },
      tasks: [
        () => calls.push("timer"),
        () => calls.push("heartbeat"),
        () => calls.push("listener"),
      ],
    })

    expect(cleanup()).toBe(true)
    expect(cleanup()).toBe(false)
    expect(calls).toEqual(["closed", "timer", "heartbeat", "listener"])
  })
})
