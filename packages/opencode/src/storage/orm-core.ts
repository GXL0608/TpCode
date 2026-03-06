import {
  bigint as pgbigint,
  customType,
  index,
  pgTable as table,
  primaryKey,
  text as pgtext,
  uniqueIndex,
} from "drizzle-orm/pg-core"

const json = customType<{ data: unknown; driverData: string }>({
  dataType() {
    return "text"
  },
  toDriver(value) {
    if (typeof value === "string") return value
    return JSON.stringify(value)
  },
  fromDriver(value) {
    if (typeof value !== "string") return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  },
})

const bool = customType<{ data: boolean; driverData: number | string | boolean }>({
  dataType() {
    return "bigint"
  },
  toDriver(value) {
    return value ? 1 : 0
  },
  fromDriver(value) {
    if (value === true || value === "t") return true
    if (value === false || value === "f") return false
    if (typeof value === "number") return value !== 0
    if (typeof value === "string") return value !== "0"
    return Boolean(value)
  },
})

const bytesType = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType() {
    return "bytea"
  },
  toDriver(value) {
    return value
  },
  fromDriver(value) {
    if (Buffer.isBuffer(value)) return value
    if (value instanceof Uint8Array) return Buffer.from(value)
    if (typeof value === "string") {
      if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex")
      return Buffer.from(value, "binary")
    }
    return Buffer.from([])
  },
})

export function text(): ReturnType<typeof pgtext>
export function text(config: { mode: "json" }): ReturnType<typeof json>
export function text(config?: { mode?: "json" }) {
  if (config?.mode === "json") return json()
  return pgtext()
}

export function integer() {
  return pgbigint({ mode: "number" })
}

export function boolean_int() {
  return bool()
}

export function bytes() {
  return bytesType()
}

export { index, primaryKey, table, uniqueIndex }
