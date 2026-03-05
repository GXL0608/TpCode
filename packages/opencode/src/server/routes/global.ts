import { Hono } from "hono"
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
import {
  createEventVisibilityCache,
  eventSessionID,
  eventVisibleToUser,
  warmEventVisibilityCache,
} from "../event-visibility"

const log = Log.create({ service: "server" })
const MAX_PENDING_EVENTS = 2000

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
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
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
          let timer: ReturnType<typeof setTimeout> | undefined
          let draining = false
          let closed = false

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
            stream.close()
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
              draining = false
            }
          }

          const queue = (event: { directory: string; payload: { type: string; properties: Record<string, unknown> } }) => {
            if (closed) return
            pending.push(event)
            if (pending.length > MAX_PENDING_EVENTS) {
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
