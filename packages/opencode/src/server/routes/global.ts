import { Hono } from "hono"
import type { Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { errors } from "../error"
import { Flag } from "../../flag/flag"
import { ServerDegraded, ServerDegradedEvent } from "../degraded"
import { GatewayState } from "../gateway-state"
import {
  createEventVisibilityCache,
  eventSessionID,
  eventVisibleToUser,
  warmEventVisibilityCache,
} from "../event-visibility"

const log = Log.create({ service: "server" })
const MAX_PENDING_EVENTS = 5000
const HEALTH_CHECK = z.object({
  degraded: z.boolean(),
  active: z.number().optional(),
  reason: z.string().optional(),
  since: z.number().optional(),
  last: z.number(),
  details: z.record(z.string(), z.unknown()).optional(),
})
const NODE = z.object({
  id: z.string(),
  host: z.string(),
  port: z.number().int().nonnegative(),
  pid: z.number().int().positive(),
  started_at: z.number().int().positive(),
  drain: z.boolean(),
  write_inflight: z.number().int().nonnegative(),
  max_write_inflight: z.number().int().positive(),
  reject_write_on_overload: z.boolean(),
  updated_at: z.number().int().positive(),
  ready: z.boolean(),
  reason: z.string().optional(),
})
const READY = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
  node_id: z.string(),
  timestamp: z.number().int().positive(),
})
const DRAIN_INPUT = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
})
const DRAIN_OUTPUT = z.object({
  ok: z.literal(true),
  drain: z.boolean(),
  reason: z.string().optional(),
  updated_at: z.number().int().positive(),
})

function nodePayload() {
  const node = GatewayState.snapshot()
  return {
    id: node.id,
    host: node.host,
    port: node.port,
    pid: node.pid,
    started_at: node.startedAt,
    drain: node.drain,
    write_inflight: node.writeInflight,
    max_write_inflight: node.maxWriteInflight,
    reject_write_on_overload: node.rejectWriteOnOverload,
    updated_at: node.updatedAt,
    ready: node.ready,
    reason: node.reason,
  }
}

function requireManagePermission(c: Context) {
  if (!Flag.TPCODE_ACCOUNT_ENABLED) return
  const permissions = c.get("account_permissions") as string[] | undefined
  if (permissions?.includes("role:manage")) return
  return c.json(
    {
      error: "forbidden",
      permission: "role:manage",
    },
    403,
  )
}

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the TpCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    healthy: z.literal(true),
                    version: z.string(),
                    degraded: z.boolean().optional(),
                    checks: z.record(z.string(), HEALTH_CHECK).optional(),
                    ready: z.boolean(),
                    node: NODE,
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const status = ServerDegraded.health()
        const node = nodePayload()
        return c.json({
          healthy: true,
          version: Installation.VERSION,
          degraded: status.degraded,
          checks: status.checks,
          ready: node.ready,
          node,
        })
      },
    )
    .get(
      "/ready",
      describeRoute({
        summary: "Get readiness",
        description: "Readiness endpoint for gateway health checks.",
        operationId: "global.ready",
        responses: {
          200: {
            description: "Ready",
            content: {
              "application/json": {
                schema: resolver(READY),
              },
            },
          },
          503: {
            description: "Not ready",
            content: {
              "application/json": {
                schema: resolver(READY),
              },
            },
          },
        },
      }),
      async (c) => {
        const state = GatewayState.snapshot()
        const payload = {
          ready: state.ready,
          reason: state.reason,
          node_id: state.id,
          timestamp: Date.now(),
        }
        if (state.ready) return c.json(payload)
        return c.json(payload, 503)
      },
    )
    .get(
      "/node",
      describeRoute({
        summary: "Get node state",
        description: "Get local node state used by gateway operations.",
        operationId: "global.node",
        responses: {
          200: {
            description: "Node state",
            content: {
              "application/json": {
                schema: resolver(NODE),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(nodePayload())
      },
    )
    .put(
      "/drain",
      describeRoute({
        summary: "Set node drain",
        description: "Enable or disable drain mode on this node.",
        operationId: "global.drain",
        responses: {
          200: {
            description: "Drain updated",
            content: {
              "application/json": {
                schema: resolver(DRAIN_OUTPUT),
              },
            },
          },
          ...errors(400, 403),
        },
      }),
      validator("json", DRAIN_INPUT),
      async (c) => {
        const denied = requireManagePermission(c)
        if (denied) return denied
        const input = c.req.valid("json")
        const result = GatewayState.setDrain({
          enabled: input.enabled,
          reason: input.reason,
        })
        return c.json({
          ok: true,
          drain: result.drain,
          reason: result.reason,
          updated_at: result.updatedAt,
        })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the TpCode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        const userID = Flag.TPCODE_ACCOUNT_ENABLED ? (c.get("account_user_id" as never) as string | undefined) : undefined
        const projectID =
          Flag.TPCODE_ACCOUNT_ENABLED ? (c.get("account_context_project_id" as never) as string | undefined) : undefined
        return streamSSE(c, async (stream) => {
          const visibilityCache = Flag.TPCODE_EVENT_VISIBILITY_CACHE ? createEventVisibilityCache() : undefined
          const pending: Array<{ directory: string; payload: { type: string; properties: Record<string, unknown> } }> = []
          const sourceID = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
          const pressure = Math.floor(MAX_PENDING_EVENTS * 0.75)
          let timer: ReturnType<typeof setTimeout> | undefined
          let draining = false
          let closed = false
          let degraded = false
          let droppedDelta = 0
          let lastDegradedAt = 0

          const close = (reason: string, error?: unknown) => {
            if (closed) return
            closed = true
            if (timer) {
              clearTimeout(timer)
              timer = undefined
            }
            if (error) {
              log.error("closing global event stream", { reason, error })
            } else {
              log.warn("closing global event stream", { reason })
            }
            ServerDegraded.clear("sse.global", {
              reason,
            }, sourceID)
            stream.close()
          }

          const clearDegraded = () => {
            if (!degraded) return
            degraded = false
            ServerDegraded.clear("sse.global", {
              pending: pending.length,
              dropped_delta: droppedDelta,
            }, sourceID)
          }

          const emitDegraded = (reason: string) => {
            const now = Date.now()
            if (now - lastDegradedAt < 3000) return
            lastDegradedAt = now
            stream
              .writeSSE({
                data: JSON.stringify({
                  directory: "global",
                  payload: {
                    type: ServerDegradedEvent.type,
                    properties: {
                      reason,
                      check: "sse.global",
                      pending: pending.length,
                      dropped_delta: droppedDelta,
                      at: now,
                    },
                  },
                }),
              })
              .catch((error) => {
                close("degraded_write_failed", error)
              })
          }

          const markDegraded = (reason: string) => {
            degraded = true
            ServerDegraded.mark("sse.global", reason, {
              pending: pending.length,
              dropped_delta: droppedDelta,
            }, sourceID)
            emitDegraded(reason)
          }

          const trimOverflow = () => {
            if (pending.length <= MAX_PENDING_EVENTS) return true
            if (!Flag.TPCODE_SSE_DROP_DELTA_ON_OVERFLOW) return false
            let dropped = 0
            while (pending.length > MAX_PENDING_EVENTS) {
              const index = pending.findIndex((item) => item.payload.type === "message.part.delta")
              if (index < 0) return false
              pending.splice(index, 1)
              dropped += 1
            }
            if (dropped > 0) {
              droppedDelta += dropped
              markDegraded("queue_pressure")
            }
            return true
          }

          const flush = async () => {
            if (draining || closed) return
            draining = true
            try {
              while (pending.length > 0) {
                const batch = pending.splice(0, 32)
                if (visibilityCache) {
                  await warmEventVisibilityCache({
                    events: batch.map((item) => item.payload),
                    userID,
                    projectID,
                    cache: visibilityCache,
                  })
                }
                for (const event of batch) {
                  if (closed) return
                  const payload = event.payload
                  const sessionID = eventSessionID(payload)
                  if ((payload.type === "session.updated" || payload.type === "session.deleted") && sessionID) {
                    visibilityCache?.delete(sessionID)
                  }
                  const visible = await eventVisibleToUser({ event: payload, userID, projectID, cache: visibilityCache })
                  if (!visible) continue
                  await stream.writeSSE({
                    data: JSON.stringify(event),
                  })
                }
              }
            } catch (error) {
              close("flush_failed", error)
            } finally {
              if (pending.length < Math.floor(pressure / 2)) {
                clearDegraded()
              }
              draining = false
            }
          }

          const queue = (event: { directory: string; payload: { type: string; properties: Record<string, unknown> } }) => {
            if (closed) return
            pending.push(event)
            if (pending.length > pressure) {
              markDegraded("queue_backlog")
            }
            if (!trimOverflow()) {
              close("queue_overflow")
              return
            }
            if (timer) return
            timer = setTimeout(() => {
              timer = undefined
              void flush()
            }, 20)
          }

          await stream
            .writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.connected",
                  properties: {},
                },
              }),
            })
            .catch((error) => {
              close("connected_write_failed", error)
            })
          if (closed) return
          async function handler(event: any) {
            const payload = event?.payload
            if (!payload || typeof payload !== "object") return
            if (typeof event?.directory !== "string") return
            queue(event as { directory: string; payload: { type: string; properties: Record<string, unknown> } })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            if (closed) return
            stream
              .writeSSE({
                data: JSON.stringify({
                  payload: {
                    type: "server.heartbeat",
                    properties: {},
                  },
                }),
              })
              .catch((error) => {
                close("heartbeat_write_failed", error)
              })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              closed = true
              if (timer) clearTimeout(timer)
              clearInterval(heartbeat)
              clearDegraded()
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global TpCode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global TpCode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all TpCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    ),
)
