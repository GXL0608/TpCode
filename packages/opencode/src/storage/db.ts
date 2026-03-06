import { drizzle } from "./orm-driver"
import type { AsyncDatabase, AsyncTransaction } from "./orm-driver"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import * as schema from "./schema"
import { QueryTrack } from "./query-track"
import { Installation } from "../installation"
import { pgSource, pgUrl } from "./pg-url"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

function dbSource() {
  return pgSource(process.env, Installation.isLocal())
}

function dbLocation(value: string) {
  try {
    const host = new URL(value).hostname
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local"
  } catch {
    return "unknown"
  }
  return "remote"
}

export namespace Database {
  type Schema = typeof schema
  type RawClient = {
    unsafe: (sql: string, params?: unknown[]) => Promise<unknown>
    close?: () => void
    end?: () => Promise<void> | void
  }
  export type Transaction = AsyncTransaction<Schema>
  type Client = AsyncDatabase<Schema> & { $client: RawClient }

  type Journal = { sql: string; timestamp: number }[]

  const state = {
    db: undefined as Client | undefined,
  }

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  function split(sql: string) {
    return sql
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.endsWith(";") ? item.slice(0, -1) : item))
  }

  function convert(sql: string) {
    return sql.replaceAll("`", '"').replace(/\binteger\b/gi, "bigint")
  }

  export function url() {
    return pgUrl(process.env, Installation.isLocal())
  }

  export function source() {
    return dbSource()
  }

  export function masked() {
    const value = url()
    const marker = "://"
    const start = value.indexOf(marker)
    const at = value.indexOf("@")
    if (start < 0 || at < 0 || at <= start + marker.length) return value
    const auth = value.slice(start + marker.length, at)
    const split = auth.indexOf(":")
    if (split < 0) return value
    const name = auth.slice(0, split)
    return `${value.slice(0, start + marker.length)}${name}:****${value.slice(at)}`
  }

  function entries() {
    if (typeof OPENCODE_MIGRATIONS !== "undefined") return OPENCODE_MIGRATIONS
    return migrations(path.join(import.meta.dirname, "../../migration"))
  }

  function esc(input: string) {
    return input.replaceAll('"', '""')
  }

  function id(input: string) {
    return `"${esc(input)}"`
  }

  async function query(client: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown> }, sql: string, params: unknown[] = []) {
    return client.unsafe(sql, params)
  }

  async function migrate(client: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown> }) {
    await query(client, `create table if not exists "opencode_migration" ("timestamp" bigint primary key not null)`)

    const rows = (await query(client, `select "timestamp" from "opencode_migration"`)) as { timestamp: number | string }[]
    const done = new Set(rows.map((row) => Number(row.timestamp)))

    for (const entry of entries()) {
      if (done.has(entry.timestamp)) continue
      let queue = split(entry.sql).map(convert)
      let step = 0
      while (queue.length > 0) {
        const next: string[] = []
        const size = queue.length
        let progress = false
        let last = ""
        for (const stmt of queue) {
          try {
            await query(client, stmt)
            progress = true
          } catch (err) {
            const text = err instanceof Error ? err.message : String(err)
            if (text.includes("already exists")) {
              progress = true
              continue
            }
            last = text
            next.push(stmt)
          }
        }
        queue = next
        step += 1
        if (queue.length === 0) break
        if (!progress || step > size + 5) {
          throw new Error(`PostgreSQL migration failed at ${entry.timestamp}: ${last}`)
        }
      }
      await query(
        client,
        `insert into "opencode_migration" ("timestamp") values ($1) on conflict ("timestamp") do nothing`,
        [entry.timestamp],
      )
    }

    const ints = (await query(
      client,
      `select table_name, column_name from information_schema.columns where table_schema = current_schema() and data_type = 'integer'`,
    )) as { table_name: string; column_name: string }[]

    for (const row of ints) {
      await query(
        client,
        `alter table ${id(row.table_name)} alter column ${id(row.column_name)} type bigint using ${id(row.column_name)}::bigint`,
      )
    }
  }

  export const Client = lazy(async () => {
    const value = url()
    const source = dbSource()
    const location = dbLocation(value)
    log.info("opening database", {
      postgres: masked(),
      source,
      location,
    })
    if (source.startsWith("DEFAULT_SEED")) {
      log.warn("database using default fallback url", {
        action: "set OPENCODE_DATABASE_URL",
        postgres: masked(),
      })
    }

    const db = drizzle(value, { schema }) as Client
    await migrate(db.$client)

    state.db = db
    return db
  })

  export async function close() {
    const db = state.db
    if (!db) return
    const client = db.$client
    if (client.end) await client.end()
    if (client.close) client.close()
    state.db = undefined
    Client.reset()
  }

  export async function raw(queryText: string, params: unknown[] = []) {
    const db = await Client()
    return (await query(db.$client, queryText, params)) as Record<string, unknown>[]
  }

  export type TxOrDb = Client | Transaction

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export async function use<T>(callback: (trx: TxOrDb) => Promise<T> | T): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const db = await Client()
        const result = await QueryTrack.scoped(() => ctx.provide({ effects, tx: db }, () => callback(db)))
        for (const effect of effects) await effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      void fn()
    }
  }

  export async function transaction<T>(callback: (tx: TxOrDb) => Promise<T> | T): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const db = await Client()
        const result = await db.transaction(async (tx: Transaction) => {
          return QueryTrack.scoped(() => ctx.provide({ tx, effects }, () => callback(tx)))
        })
        for (const effect of effects) await effect()
        return result
      }
      throw err
    }
  }
}
