import { describe, expect, test } from "bun:test"
import { Queue } from "../../src/observability/queue"
import type { LogEvent } from "../../src/observability/schema"

function event(level: LogEvent["level"], message: string): LogEvent {
  return {
    level,
    service: "test",
    event: "test.event",
    message,
    status: "ok",
    created_at: new Date(0).toISOString(),
    count: 1,
    tags: {},
    extra: {},
  }
}

describe("observability queue", () => {
  test("drops lower priority entries before warn and error", () => {
    const queue = Queue.create({ limit: 2, now: () => new Date(0).toISOString() })

    expect(queue.push(event("DEBUG", "debug"))).toBe(true)
    expect(queue.push(event("INFO", "info"))).toBe(true)
    expect(queue.push(event("ERROR", "error"))).toBe(true)

    const batch = queue.take(10)

    expect(batch.map((item) => item.message)).toEqual(["info", "error"])
    expect(queue.summary("log")).toEqual({
      created_at: new Date(0).toISOString(),
      level: "WARN",
      service: "log",
      event: "log.drop.summary",
      message: "log drop summary",
      status: "dropped",
      count: 1,
      tags: {},
      extra: {
        dropped: {
          DEBUG: 1,
        },
      },
    })
  })
})
