import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import type { EventEmitter } from "events"
import { Global } from "../global"
import { Glob } from "../util/glob"
import type { LogLevel } from "./schema"
import type { LogEvent } from "./schema"

async function cleanup(dir: string) {
  const files = await Glob.scan("????-??-??T??????.log", {
    cwd: dir,
    absolute: true,
    include: "file",
  })
  if (files.length <= 5) return
  await Promise.all(files.slice(0, -10).map((file) => fs.unlink(file).catch(() => {})))
}

function line(event: LogEvent) {
  const parts = [
    event.event ? `event=${event.event}` : undefined,
    event.status ? `status=${event.status}` : undefined,
    event.service ? `service=${event.service}` : undefined,
    event.request_id ? `request_id=${event.request_id}` : undefined,
    event.session_id ? `session_id=${event.session_id}` : undefined,
    event.message_id ? `message_id=${event.message_id}` : undefined,
    event.user_id ? `user_id=${event.user_id}` : undefined,
    event.project_id ? `project_id=${event.project_id}` : undefined,
    event.workspace_id ? `workspace_id=${event.workspace_id}` : undefined,
    event.provider_id ? `provider_id=${event.provider_id}` : undefined,
    event.model_id ? `model_id=${event.model_id}` : undefined,
    event.agent ? `agent=${event.agent}` : undefined,
    event.duration_ms !== undefined ? `duration_ms=${event.duration_ms}` : undefined,
    ...Object.entries(event.tags).map(([key, value]) => `${key}=${value}`),
    ...Object.entries(event.extra).map(([key, value]) =>
      typeof value === "object" ? `${key}=${JSON.stringify(value)}` : `${key}=${String(value)}`,
    ),
    event.message,
  ]
    .filter(Boolean)
    .join(" ")
  return `${event.level} ${event.created_at.split(".")[0]} ${parts}\n`
}

export namespace Logger {
  export async function create(input: {
    print: boolean
    dev?: boolean
    level: LogLevel
    stream?: Pick<EventEmitter, "once"> & {
      write(text: string): boolean
      end(cb?: () => void): void
    }
  }) {
    const file = input.print
      ? ""
      : path.join(
          Global.Path.log,
          input.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
        )

    if (file) {
      await cleanup(Global.Path.log)
      await fs.truncate(file).catch(() => {})
    }

    const stream = input.print ? undefined : input.stream ?? createWriteStream(file, { flags: "a" })
    const pending: string[] = []
    let blocked = false
    const drain = () => {
      if (!stream) return
      blocked = false
      while (pending.length) {
        const ok = stream.write(pending.shift()!)
        if (ok) continue
        blocked = true
        stream.once("drain", drain)
        return
      }
    }
    const write = (text: string) => {
      if (input.print || !stream) {
        process.stderr.write(text)
        return
      }
      if (blocked) {
        pending.push(text)
        return
      }
      const ok = stream.write(text)
      if (ok) return
      blocked = true
      stream.once("drain", drain)
    }

    return {
      file,
      write(event: LogEvent) {
        write(line(event))
      },
      async close() {
        if (!stream) return
        if (blocked) {
          await new Promise<void>((resolve) => {
            stream.once("drain", () => {
              drain()
              resolve()
            })
          }).catch(() => {})
        }
        await new Promise<void>((resolve) => stream.end(resolve)).catch(() => {})
      },
    }
  }
}
