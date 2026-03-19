import { GlobalBus } from "../../bus/global"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { createSSECleanup } from "../../server/sse-cleanup"

/** 中文注释：提供工作区事件 SSE 路由，并在异常关闭时及时释放心跳与全局总线监听。 */
export function WorkspaceServerRoutes() {
  return new Hono().get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, async (stream) => {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | undefined
      const send = async (event: unknown) => {
        if (closed) return
        await stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
      const handler = async (event: { directory?: string; payload: unknown }) => {
        await send(event.payload)
      }
      const cleanup = createSSECleanup({
        onClosed() {
          closed = true
        },
        tasks: [
          () => {
            if (!heartbeat) return
            clearInterval(heartbeat)
            heartbeat = undefined
          },
          () => {
            GlobalBus.off("event", handler)
          },
        ],
      })
      GlobalBus.on("event", handler)
      await send({ type: "server.connected", properties: {} }).catch(() => {
        cleanup()
      })
      if (closed) return
      heartbeat = setInterval(() => {
        void send({ type: "server.heartbeat", properties: {} }).catch(() => {
          cleanup()
          stream.close()
        })
      }, 10_000)

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          cleanup()
          resolve()
        })
      })
    })
  })
}
