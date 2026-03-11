import { pgUrl } from "../storage/pg-url"
import type { LogEvent } from "./schema"
import { Spool } from "./spool"

declare const OPENCODE_CHANNEL: string | undefined

type Client = {
  unsafe: (sql: string, params?: unknown[]) => Promise<unknown>
  end?: () => Promise<void> | void
  close?: () => void
}

function dev() {
  return typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL === "local" : true
}

function sql(input: LogEvent[]) {
  const values: unknown[] = []
  const rows = input.map((item) => {
    values.push(
      item.created_at,
      item.level,
      item.service,
      item.event,
      item.message,
      item.status,
      item.duration_ms ?? null,
      item.request_id ?? null,
      item.session_id ?? null,
      item.message_id ?? null,
      item.user_id ?? null,
      item.project_id ?? null,
      item.workspace_id ?? null,
      item.provider_id ?? null,
      item.model_id ?? null,
      item.agent ?? null,
      item.count,
      JSON.stringify(item.tags),
      JSON.stringify(item.extra),
    )
    const index = values.length - 19
    return `($${index + 1}::timestamptz, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, $${index + 6}, $${index + 7}, $${index + 8}, $${index + 9}, $${index + 10}, $${index + 11}, $${index + 12}, $${index + 13}, $${index + 14}, $${index + 15}, $${index + 16}, $${index + 17}, $${index + 18}::jsonb, $${index + 19}::jsonb)`
  })

  return {
    text: `
      INSERT INTO "app_event_log" (
        "created_at",
        "level",
        "service",
        "event",
        "message",
        "status",
        "duration_ms",
        "request_id",
        "session_id",
        "message_id",
        "user_id",
        "project_id",
        "workspace_id",
        "provider_id",
        "model_id",
        "agent",
        "count",
        "tags",
        "extra"
      )
      VALUES ${rows.join(",")}
    `,
    values,
  }
}

export namespace Writer {
  export function create(input?: {
    client?: () => Promise<Client> | Client
    spool?: Pick<ReturnType<typeof Spool.create>, "write">
    report?: (event: LogEvent) => Promise<void>
  }) {
    let cached: Client | undefined
    const spool = input?.spool ?? Spool.create()

    async function client() {
      if (cached) return cached
      const value =
        input?.client?.() ??
        new Bun.SQL(pgUrl(process.env, dev()), {
          idleTimeout: 30,
          max: 1,
        })
      cached = await Promise.resolve(value)
      return cached
    }

    async function insert(batch: LogEvent[]) {
      if (!batch.length) return
      const next = sql(batch)
      await (await client()).unsafe(next.text, next.values)
    }

    return {
      async flush(batch: LogEvent[], options?: { spool?: boolean; meta?: boolean }) {
        if (!batch.length) return true
        try {
          await insert(batch)
          return true
        } catch {
          try {
            await insert(batch)
            return true
          } catch {
            if (options?.spool === false) return false
            await spool.write(batch)
            if (!options?.meta) {
              await input?.report?.({
                created_at: new Date().toISOString(),
                level: "WARN",
                service: "log",
                event: "log.spool.write",
                message: "spool write",
                status: "completed",
                count: 1,
                tags: {},
                extra: {
                  batch_size: batch.length,
                },
              })
            }
            return false
          }
        }
      },
      async close() {
        if (!cached) return
        if (cached.end) await cached.end()
        if (cached.close) cached.close()
        cached = undefined
      },
    }
  }
}
