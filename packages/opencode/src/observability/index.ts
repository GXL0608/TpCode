import { build, type LogEvent, type LogLevel } from "./schema"
import { Queue } from "./queue"
import { Writer } from "./writer"
import { Replay } from "./replay"
import { Logger } from "./logger"
import { ObserveContext } from "./context"

type Sink = {
  flush: (batch: LogEvent[], options?: { spool?: boolean; meta?: boolean }) => Promise<boolean>
  close: () => Promise<void> | void
}

const rank: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const state = {
  batch_size: 200,
  flush_interval_ms: 250,
  queue_limit: 5000,
  replay_interval_ms: 5000,
  level: "INFO" as LogLevel,
  queue: Queue.create(),
  sink: Writer.create() as Sink,
  replay: undefined as ReturnType<typeof Replay.create> | undefined,
  logger: undefined as Awaited<ReturnType<typeof Logger.create>> | undefined,
  flush: undefined as ReturnType<typeof setInterval> | undefined,
  replay_timer: undefined as ReturnType<typeof setInterval> | undefined,
  active: false,
  deferred: false,
  running: Promise.resolve(),
}

async function report(event: LogEvent, options?: { spool?: boolean }) {
  if (!state.active) return
  await state.sink.flush([event], {
    spool: options?.spool,
    meta: true,
  })
}

function timers() {
  if (state.flush || state.replay_timer) return
  state.flush = setInterval(() => {
    void tick()
  }, state.flush_interval_ms)
  state.replay_timer = setInterval(() => {
    void state.replay?.run()
  }, state.replay_interval_ms)
  schedule(state.flush)
  schedule(state.replay_timer)
}

async function tick() {
  const summary = state.queue.summary("log")
  const batch = state.queue.take(state.batch_size)
  if (summary) batch.unshift(summary)
  if (!batch.length) return
  const started = Date.now()
  const size = batch.length
  state.running = state.running
    .catch(() => {})
    .then(async () => {
      const ok = await state.sink.flush(batch).catch(() => false)
      await report(
        build({
          level: ok ? "INFO" : "ERROR",
          message: "flush batch",
          tags: {
            service: "log",
            event: "log.flush.batch",
          },
          extra: {
            batch_size: size,
            duration_ms: Date.now() - started,
            status: ok ? "completed" : "error",
          },
        }),
        { spool: true },
      )
      if (ok) return
    })
  await state.running
}

function schedule(timer: ReturnType<typeof setInterval> | undefined) {
  timer?.unref?.()
}

async function reset(drain: boolean) {
  if (!state.active) return
  if (state.flush) clearInterval(state.flush)
  if (state.replay_timer) clearInterval(state.replay_timer)
  if (drain) {
    const until = Date.now() + 2000
    while (state.queue.size() > 0 && Date.now() < until) {
      await tick()
    }
    await state.replay?.run()
    await state.running
  }
  await state.sink.close()
  await state.logger?.close()
  state.queue = Queue.create({ limit: state.queue_limit })
  state.logger = undefined
  state.replay = undefined
  state.flush = undefined
  state.replay_timer = undefined
  state.active = false
  state.deferred = false
}

export namespace Observe {
  export function file() {
    return state.logger?.file ?? ""
  }

  export function context() {
    return ObserveContext.current()
  }

  export async function init(input: {
    print: boolean
    dev?: boolean
    level: LogLevel
    batch_size?: number
    flush_interval_ms?: number
    queue_limit?: number
    defer?: boolean
    sink?: Sink
  }) {
    await reset(true)
    state.batch_size = input.batch_size ?? 200
    state.flush_interval_ms = input.flush_interval_ms ?? 250
    state.queue_limit = input.queue_limit ?? 5000
    state.level = input.level
    state.queue = Queue.create({ limit: state.queue_limit })
    state.sink =
      input.sink ??
      Writer.create({
        report(event) {
          return report(event, { spool: true })
        },
      })
    state.replay = Replay.create({
      writer: state.sink,
      report(event) {
        return report(event, { spool: false })
      },
    })
    state.logger = await Logger.create(input)
    state.deferred = input.defer === true
    state.active = true
    if (!state.deferred) timers()
  }

  export async function test(input: { write: (batch: LogEvent[]) => Promise<void> | void }) {
    await reset(false)
    state.queue = Queue.create({ limit: 5000 })
    state.level = "DEBUG"
    state.sink = {
      async flush(batch) {
        await input.write(batch)
        return true
      },
      async close() {},
    }
    state.replay = undefined
    state.logger = undefined
    state.active = true
    state.deferred = false
  }

  export function emit(event: LogEvent) {
    if (rank[event.level] < rank[state.level]) return
    if (state.logger) {
      state.logger.write(event)
    }
    state.queue.push(event)
  }

  export async function flush() {
    await tick()
  }

  export async function ready() {
    if (!state.active) return
    state.deferred = false
    timers()
  }

  export async function stop() {
    await reset(true)
  }
}
