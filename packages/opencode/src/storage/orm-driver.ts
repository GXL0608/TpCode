import { drizzle as core } from "drizzle-orm/bun-sql"
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres"
import { PgAsyncDeleteBase } from "drizzle-orm/pg-core/async/delete"
import { PgAsyncInsertBase } from "drizzle-orm/pg-core/async/insert"
import { PgAsyncSelectBase } from "drizzle-orm/pg-core/async/select"
import { PgAsyncUpdateBase } from "drizzle-orm/pg-core/async/update"
import type { PgAsyncTransaction } from "drizzle-orm/pg-core/async/session"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session"
import { QueryTrack } from "./query-track"

type Result = {
  changes: number
  lastInsertRowid: number
}

type Query = {
  execute: (values?: Record<string, unknown>) => Promise<unknown>
}

function first(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value[0]
}

function count(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (typeof value === "object" && value !== null) {
    const data = value as Record<string, unknown>
    const row = data.rowCount ?? data.count
    if (typeof row === "number") return row
    if (typeof row === "string") {
      const parsed = Number(row)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function run(this: Query, values?: Record<string, unknown>) {
  return QueryTrack.track(this.execute(values).then((value) => {
    return {
      changes: count(value),
      lastInsertRowid: 0,
    } satisfies Result
  }))
}

function all(this: Query, values?: Record<string, unknown>) {
  return QueryTrack.track(this.execute(values)) as Promise<unknown[]>
}

function get(this: Query, values?: Record<string, unknown>) {
  return QueryTrack.track(this.execute(values).then(first))
}

function patch(proto: Record<string, unknown>) {
  if (!("run" in proto)) {
    Object.defineProperty(proto, "run", { value: run, configurable: true })
  }
  if (!("all" in proto)) {
    Object.defineProperty(proto, "all", { value: all, configurable: true })
  }
  if (!("get" in proto)) {
    Object.defineProperty(proto, "get", { value: get, configurable: true })
  }
}

patch(PgAsyncSelectBase.prototype as unknown as Record<string, unknown>)
patch(PgAsyncInsertBase.prototype as unknown as Record<string, unknown>)
patch(PgAsyncUpdateBase.prototype as unknown as Record<string, unknown>)
patch(PgAsyncDeleteBase.prototype as unknown as Record<string, unknown>)

export const drizzle = core.postgres

export type AsyncDatabase<T extends Record<string, unknown>> = BunSQLDatabase<T>
export type AsyncTransaction<T extends Record<string, unknown>> = PgAsyncTransaction<PgQueryResultHKT, T>
