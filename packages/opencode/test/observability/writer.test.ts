import { describe, expect, test } from "bun:test"
import { Replay } from "../../src/observability/replay"
import { Writer } from "../../src/observability/writer"
import type { LogEvent } from "../../src/observability/schema"

function event(): LogEvent {
  return {
    created_at: new Date(0).toISOString(),
    level: "INFO",
    service: "test",
    event: "test.event",
    message: "hello",
    status: "ok",
    count: 1,
    tags: {},
    extra: {},
  }
}

describe("observability writer", () => {
  test("falls back to spool after retry failure", async () => {
    const writes: LogEvent[][] = []
    let attempts = 0
    const writer = Writer.create({
      client: async () => ({
        unsafe: async () => {
          attempts++
          throw new Error("boom")
        },
      }),
      spool: {
        write: async (batch) => {
          writes.push(batch)
          return "spool.jsonl"
        },
      },
    })

    const ok = await writer.flush([event()])

    expect(ok).toBe(false)
    expect(attempts).toBe(2)
    expect(writes).toHaveLength(1)
    expect(writes[0][0].event).toBe("test.event")
  })

  test("reports spool writes", async () => {
    const events: LogEvent[] = []
    const writer = Writer.create({
      client: async () => ({
        unsafe: async () => {
          throw new Error("boom")
        },
      }),
      spool: {
        write: async () => "spool.jsonl",
      },
      report: async (event) => {
        events.push(event)
      },
    })

    await writer.flush([event()])

    expect(events.some((item) => item.event === "log.spool.write")).toBe(true)
  })

  test("reports replay events", async () => {
    const events: LogEvent[] = []
    const replay = Replay.create({
      spool: {
        dir: "spool",
        write: async () => "",
        list: async () => ["a.jsonl"],
        read: async () => [event()],
        remove: async () => {},
      },
      writer: {
        flush: async () => true,
      },
      report: async (event) => {
        events.push(event)
      },
    })

    await replay.run()

    expect(events.some((item) => item.event === "log.spool.replay")).toBe(true)
  })
})
