import z from "zod"
import { BusEvent } from "@/bus/bus-event"

const Check = z.object({
  degraded: z.boolean(),
  active: z.number(),
  reason: z.string().optional(),
  since: z.number().optional(),
  last: z.number(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const ServerDegradedEvent = BusEvent.define(
  "server.degraded",
  z.object({
    reason: z.string(),
    check: z.string(),
    pending: z.number().optional(),
    dropped_delta: z.number().optional(),
    at: z.number(),
  }),
)

const DEFAULT_SOURCE = "__default__"

const checks = new Map<
  string,
  {
    active: Set<string>
    reason?: string
    since?: number
    last: number
    details?: Record<string, unknown>
  }
>()

export namespace ServerDegraded {
  function ensure(check: string) {
    const now = Date.now()
    const existing = checks.get(check)
    if (existing) return existing
    const created = {
      active: new Set<string>(),
      reason: undefined as string | undefined,
      since: undefined as number | undefined,
      last: now,
      details: undefined as Record<string, unknown> | undefined,
    }
    checks.set(check, created)
    return created
  }

  export function set(
    check: string,
    input: {
      degraded: boolean
      reason?: string
      details?: Record<string, unknown>
      source?: string
    }
  ) {
    const source = input.source ?? DEFAULT_SOURCE
    const row = ensure(check)
    const now = Date.now()
    if (input.degraded) {
      row.active.add(source)
      row.reason = input.reason
      row.details = input.details
      row.last = now
      if (!row.since) row.since = now
      return
    }
    row.active.delete(source)
    row.last = now
    row.details = input.details
    if (row.active.size > 0) return
    row.reason = undefined
    row.since = undefined
  }

  export function mark(check: string, reason: string, details?: Record<string, unknown>, source?: string) {
    set(check, {
      degraded: true,
      reason,
      details,
      source,
    })
  }

  export function clear(check: string, details?: Record<string, unknown>, source?: string) {
    set(check, {
      degraded: false,
      details,
      source,
    })
  }

  export function health() {
    const values = [...checks.values()].map((item) => ({
      degraded: item.active.size > 0,
      active: item.active.size,
      reason: item.reason,
      since: item.since,
      last: item.last,
      details: item.details,
    }))
    return {
      degraded: values.some((value) => value.degraded),
      checks: Object.fromEntries(
        [...checks.entries()].map(([check, item]) => [
          check,
          {
            degraded: item.active.size > 0,
            active: item.active.size,
            reason: item.reason,
            since: item.since,
            last: item.last,
            details: item.details,
          },
        ]),
      ) as Record<string, z.infer<typeof Check>>,
    }
  }
}
