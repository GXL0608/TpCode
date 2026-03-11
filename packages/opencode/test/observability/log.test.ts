import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter } from "events"
import { Observe } from "../../src/observability"
import { Log } from "../../src/util/log"
import type { LogEvent } from "../../src/observability/schema"
import { Logger } from "../../src/observability/logger"

describe("util log", () => {
  afterEach(async () => {
    await Observe.stop()
  })

  test("time emits duration_ms when stopped", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    const timer = Log.create({ service: "session.prompt" }).time("loop", {
      event: "session.prompt.loop",
    })

    await Bun.sleep(5)
    timer.stop()
    await Observe.flush()

    const match = events.find((item) => item.event === "session.prompt.loop" && item.status === "completed")
    expect(match).toBeDefined()
    expect(match?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(match?.service).toBe("session.prompt")
  })

  test("logger keeps human readable text output", async () => {
    const logger = await Logger.create({
      print: false,
      dev: true,
      level: "INFO",
    })

    logger.write({
      created_at: "2026-03-11T12:00:00.000Z",
      level: "INFO",
      service: "session",
      event: "session.get",
      message: "get",
      status: "ok",
      duration_ms: 12,
      session_id: "ses_1",
      count: 1,
      tags: {
        path: "/session/1",
      },
      extra: {},
    })
    await logger.close()

    const text = await Bun.file(logger.file).text()
    expect(text).toContain("INFO")
    expect(text).toContain("event=session.get")
    expect(text).toContain("session_id=ses_1")
    expect(text).toContain("get")
  })

  test("observe defer keeps events queued until ready", async () => {
    const events: LogEvent[] = []
    await Observe.init({
      print: true,
      level: "DEBUG",
      defer: true,
      sink: {
        async flush(batch) {
          events.push(...batch)
          return true
        },
        async close() {},
      },
    })

    Log.create({ service: "session" }).info("queued", { event: "session.get" })
    await Bun.sleep(10)
    expect(events).toHaveLength(0)

    await Observe.ready()
    await Observe.flush()

    expect(events.some((item) => item.event === "session.get")).toBe(true)
  })

  test("observe emits log.flush.batch", async () => {
    const events: LogEvent[] = []
    await Observe.test({
      write: async (batch) => {
        events.push(...batch)
      },
    })

    Log.create({ service: "session" }).info("get", { event: "session.get" })
    await Observe.flush()

    expect(events.some((item) => item.event === "log.flush.batch")).toBe(true)
  })

  test("logger drains buffered writes after backpressure", async () => {
    const output: string[] = []
    const fake = new EventEmitter() as EventEmitter & {
      write(text: string): boolean
      end(cb?: () => void): void
    }
    let blocked = true
    fake.write = (text) => {
      if (blocked) {
        blocked = false
        return false
      }
      output.push(text)
      return true
    }
    fake.end = (cb) => {
      cb?.()
    }

    const logger = await Logger.create({
      print: false,
      dev: true,
      level: "INFO",
      stream: fake,
    })

    logger.write({
      created_at: "2026-03-11T12:00:00.000Z",
      level: "INFO",
      service: "session",
      event: "session.get",
      message: "first",
      status: "ok",
      count: 1,
      tags: {},
      extra: {},
    })
    logger.write({
      created_at: "2026-03-11T12:00:01.000Z",
      level: "INFO",
      service: "session",
      event: "session.messages",
      message: "second",
      status: "ok",
      count: 1,
      tags: {},
      extra: {},
    })
    fake.emit("drain")
    await logger.close()

    expect(output.join("")).toContain("second")
  })
})
