export const levels = ["DEBUG", "INFO", "WARN", "ERROR"] as const
export const statuses = ["ok", "error", "timeout", "cancelled", "dropped", "completed", "started"] as const

export type LogLevel = (typeof levels)[number]
export type LogStatus = (typeof statuses)[number]

export type LogEvent = {
  created_at: string
  level: LogLevel
  service: string
  event: string
  message: string
  status: LogStatus
  duration_ms?: number
  request_id?: string
  session_id?: string
  message_id?: string
  user_id?: string
  project_id?: string
  workspace_id?: string
  provider_id?: string
  model_id?: string
  agent?: string
  count: number
  tags: Record<string, string>
  extra: Record<string, unknown>
}

type Fields = Record<string, unknown>

const aliases = {
  service: ["service"],
  event: ["event"],
  status: ["status"],
  duration_ms: ["duration_ms", "duration"],
  request_id: ["request_id", "requestID"],
  session_id: ["session_id", "sessionID"],
  message_id: ["message_id", "messageID"],
  user_id: ["user_id", "userID"],
  project_id: ["project_id", "projectID"],
  workspace_id: ["workspace_id", "workspaceID"],
  provider_id: ["provider_id", "providerID"],
  model_id: ["model_id", "modelID"],
  agent: ["agent"],
  count: ["count"],
} as const

const skipped = new Set<string>(Object.values(aliases).flat())

function serial(value: unknown, depth = 0): unknown {
  if (value === undefined) return
  if (value === null) return null
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: trim(value.stack),
      cause: depth < 3 ? serial(value.cause, depth + 1) : undefined,
    }
  }
  if (Array.isArray(value)) return value.map((item) => serial(item, depth + 1))
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, serial(item, depth + 1)] as const)
        .filter((item): item is [string, unknown] => item[1] !== undefined),
    )
  }
  if (typeof value === "string") return trim(value)
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "boolean") return value
  if (typeof value === "bigint") return Number(value)
  return String(value)
}

function trim(value?: string, max = 4000) {
  if (!value) return value
  if (value.length <= max) return value
  return value.slice(0, max) + "...(truncated)"
}

function message(value: unknown) {
  if (value instanceof Error) return trim(value.message) ?? value.name
  if (typeof value === "string") return trim(value) ?? "log"
  if (value === undefined || value === null) return "log"
  const next = serial(value)
  if (typeof next === "string") return next
  return trim(JSON.stringify(next)) ?? "log"
}

function pick(data: Fields, keys: readonly string[]) {
  for (const key of keys) {
    const value = data[key]
    if (value !== undefined && value !== null) return value
  }
}

function status(value: unknown, level: LogLevel): LogStatus {
  if (typeof value === "string" && statuses.includes(value as LogStatus)) return value as LogStatus
  if (level === "ERROR") return "error"
  return "ok"
}

function count(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value)
  return 1
}

function duration(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value)
}

function string(value: unknown) {
  if (typeof value === "string" && value) return value
}

function primitive(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

export function build(input: {
  level: LogLevel
  message?: unknown
  tags?: Fields
  extra?: Fields
  context?: Fields
  now?: () => string
}): LogEvent {
  const merged = {
    ...input.context,
    ...input.tags,
    ...input.extra,
  }
  const extra: Record<string, unknown> = {}
  const tags: Record<string, string> = {}

  for (const [key, value] of Object.entries(merged)) {
    if (skipped.has(key)) continue
    const next = serial(value)
    if (next === undefined) continue
    if ((typeof next === "string" || typeof next === "boolean") && String(next).length <= 200) {
      tags[key] = String(next)
      continue
    }
    extra[key] = next
  }

  const service = string(pick(merged, aliases.service)) ?? "default"
  return {
    created_at: input.now?.() ?? new Date().toISOString(),
    level: input.level,
    service,
    event: string(pick(merged, aliases.event)) ?? `${service}.log`,
    message: message(input.message),
    status: status(pick(merged, aliases.status), input.level),
    duration_ms: duration(pick(merged, aliases.duration_ms)),
    request_id: string(pick(merged, aliases.request_id)),
    session_id: string(pick(merged, aliases.session_id)),
    message_id: string(pick(merged, aliases.message_id)),
    user_id: string(pick(merged, aliases.user_id)),
    project_id: string(pick(merged, aliases.project_id)),
    workspace_id: string(pick(merged, aliases.workspace_id)),
    provider_id: string(pick(merged, aliases.provider_id)),
    model_id: string(pick(merged, aliases.model_id)),
    agent: string(pick(merged, aliases.agent)),
    count: count(pick(merged, aliases.count)),
    tags,
    extra,
  }
}
