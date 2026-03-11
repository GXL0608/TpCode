import z from "zod"
import { Observe } from "../observability"
import { ObserveContext } from "../observability/context"
import { build, levels } from "../observability/schema"

type Fields = Record<string, unknown>

function format(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10 ? result + " Caused by: " + format(error.cause, depth + 1) : result
}

function text(message: unknown) {
  if (message instanceof Error) return format(message)
  return message
}

export namespace Log {
  export const Level = z.enum(levels).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  export type Logger = {
    debug(message?: unknown, extra?: Fields): void
    info(message?: unknown, extra?: Fields): void
    error(message?: unknown, extra?: Fields): void
    warn(message?: unknown, extra?: Fields): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Fields,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
    defer?: boolean
  }

  const loggers = new Map<string, Logger>()

  export const Default = create({ service: "default" })

  export function file() {
    return Observe.file()
  }

  export async function init(options: Options) {
    await Observe.init({
      print: options.print,
      dev: options.dev,
      level: options.level ?? "INFO",
      defer: options.defer,
    })
  }

  export async function ready() {
    await Observe.ready()
  }

  export async function shutdown() {
    await Observe.stop()
  }

  export function provide<T>(value: Fields, fn: () => T) {
    return ObserveContext.provide(value, fn)
  }

  export function create(input?: Fields) {
    const tags = input ? { ...input } : {}
    const service = typeof tags["service"] === "string" ? tags["service"] : undefined
    if (service && Object.keys(tags).length === 1) {
      const cached = loggers.get(service)
      if (cached) return cached
    }

    function write(level: Level, message?: unknown, extra?: Fields) {
      Observe.emit(
        build({
          level,
          message: text(message),
          tags,
          extra,
          context: Observe.context(),
        }),
      )
    }

    const result: Logger = {
      debug(message, extra) {
        write("DEBUG", message, extra)
      },
      info(message, extra) {
        write("INFO", message, extra)
      },
      error(message, extra) {
        write("ERROR", message, extra)
      },
      warn(message, extra) {
        write("WARN", message, extra)
      },
      tag(key, value) {
        tags[key] = value
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
      time(message: string, extra?: Fields) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        function stop() {
          result.info(message, {
            status: "completed",
            duration_ms: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (service && Object.keys(tags).length === 1) {
      loggers.set(service, result)
    }

    return result
  }
}
