import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Database, eq, and, lte, lt } from "@/storage/db"
import { SyncQueueTable } from "./session.sql"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "sync" })

export namespace SessionSync {
  const state = Instance.state(() => ({
    initialized: false,
    retryWorkerRunning: false,
  }))

  interface SyncPayload {
    type: "session" | "message"
    timestamp: number
    data: any
  }

  /**
   * 初始化同步模块
   * 订阅事件并启动后台重试任务
   */
  export async function initialize(): Promise<void> {
    const instanceState = state()

    if (instanceState.initialized) {
      log.debug("sync already initialized for this instance")
      return
    }

    const config = await Config.state().then((s) => s.config)

    if (!config.sync?.enabled) {
      log.debug("sync is disabled in config")
      return
    }

    log.info("initializing session sync", {
      endpoint: config.sync.endpoint,
      retryAttempts: config.sync.retryAttempts,
    })

    // 订阅会话事件
    log.info("subscribing to session events")
    const sub1 = Bus.subscribe(Session.Event.Created, async (event) => {
      log.info("session.created event received", { sessionID: event.properties.info.id })
      try {
        await handleSessionEvent("session.created", event.properties.info)
      } catch (err) {
        log.error("error handling session.created", { error: err })
      }
    })
    log.info("session.created subscription created", { hasSubscription: !!sub1 })

    const sub2 = Bus.subscribe(Session.Event.Updated, async (event) => {
      log.info("session.updated event received", { sessionID: event.properties.info.id })
      try {
        await handleSessionEvent("session.updated", event.properties.info)
      } catch (err) {
        log.error("error handling session.updated", { error: err })
      }
    })
    log.info("session.updated subscription created", { hasSubscription: !!sub2 })

    // 订阅消息事件
    log.info("subscribing to message events")
    const sub3 = Bus.subscribe(MessageV2.Event.Updated, async (event) => {
      log.info("message.updated event received", { sessionID: event.properties.info.sessionID, messageID: event.properties.info.id })
      try {
        await handleMessageEvent(event.properties.info.sessionID, event.properties.info.id)
      } catch (err) {
        log.error("error handling message.updated", { error: err })
      }
    })
    log.info("message.updated subscription created", { hasSubscription: !!sub3 })

    // 启动后台重试任务
    if (!instanceState.retryWorkerRunning) {
      instanceState.retryWorkerRunning = true
      log.info("retry worker started")
      retryWorker().catch((err) => {
        log.error("retry worker failed", { error: err })
        instanceState.retryWorkerRunning = false
      })
    }

    instanceState.initialized = true
    log.info("session sync initialized successfully")
  }

  /**
   * 处理会话事件
   */
  async function handleSessionEvent(eventType: string, sessionInfo: Session.Info): Promise<void> {
    try {
      const payload: SyncPayload = {
        type: "session",
        timestamp: Date.now(),
        data: {
          id: sessionInfo.id,
          projectID: sessionInfo.projectID,
          workspaceID: sessionInfo.workspaceID,
          parentID: sessionInfo.parentID,
          slug: sessionInfo.slug,
          directory: sessionInfo.directory,
          title: sessionInfo.title,
          version: sessionInfo.version,
          summary: sessionInfo.summary,
          time: sessionInfo.time,
        },
      }

      await sendToServer(payload)
      log.debug("session synced successfully", { sessionID: sessionInfo.id, eventType })
    } catch (error) {
      log.warn("failed to sync session", { sessionID: sessionInfo.id, error })
      await enqueueRetry(eventType, sessionInfo.id, { type: "session", data: sessionInfo }, error)
    }
  }

  /**
   * 处理消息事件
   */
  async function handleMessageEvent(sessionID: string, messageID: string): Promise<void> {
    try {
      // 获取完整的消息数据
      const message = await MessageV2.get({ sessionID, messageID })

      const payload: SyncPayload = {
        type: "message",
        timestamp: Date.now(),
        data: {
          sessionID,
          message: {
            id: message.info.id,
            role: message.info.role,
            parentID: message.info.parentID,
            parts: message.parts,
            time: message.info.time,
            usage: message.info.usage,
            finish: message.info.finish,
            summary: message.info.summary,
            error: message.info.error,
          },
        },
      }

      await sendToServer(payload)
      log.debug("message synced successfully", { sessionID, messageID })
    } catch (error) {
      log.warn("failed to sync message", { sessionID, messageID, error })
      await enqueueRetry("message.updated", sessionID, { type: "message", sessionID, messageID }, error)
    }
  }

  /**
   * 发送数据到中心服务器
   */
  async function sendToServer(payload: SyncPayload): Promise<void> {
    const config = await Config.state().then((s) => s.config)

    if (!config.sync?.enabled) {
      throw new Error("Sync is not enabled")
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (config.sync.apiKey) {
      headers["Authorization"] = `Bearer ${config.sync.apiKey}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.sync.timeout)

    try {
      const response = await fetch(config.sync.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error")
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      log.debug("data sent to server successfully", { type: payload.type })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 将失败的同步任务加入重试队列
   */
  async function enqueueRetry(
    eventType: string,
    sessionID: string,
    payload: any,
    error: unknown,
  ): Promise<void> {
    const config = await Config.state().then((s) => s.config)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const nextRetry = Date.now() + (config.sync?.retryDelay ?? 5000)

    try {
      Database.use((db) => {
        db.insert(SyncQueueTable)
          .values({
            id: Identifier.ascending("sync"),
            session_id: sessionID,
            event_type: eventType,
            payload: JSON.stringify(payload),
            attempts: 0,
            last_error: errorMessage,
            next_retry: nextRetry,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
      })

      log.debug("task enqueued for retry", { sessionID, eventType, nextRetry })
    } catch (err) {
      log.error("failed to enqueue retry task", { sessionID, error: err })
    }
  }

  /**
   * 后台重试任务
   * 定期扫描队列并重试失败的同步任务
   */
  async function retryWorker(): Promise<void> {
    const instanceState = state()
    log.info("retry worker started")

    while (instanceState.retryWorkerRunning) {
      try {
        await processRetryQueue()
      } catch (error) {
        log.error("error in retry worker", { error })
      }

      // 等待30秒后再次检查
      await new Promise((resolve) => setTimeout(resolve, 30000))
    }

    log.info("retry worker stopped")
  }

  /**
   * 处理重试队列
   */
  async function processRetryQueue(): Promise<void> {
    const config = await Config.state().then((s) => s.config)

    if (!config.sync?.enabled) {
      return
    }

    const now = Date.now()
    const maxAttempts = config.sync.retryAttempts ?? 5
    const batchSize = config.sync.batchSize ?? 10

    const tasks = Database.use((db) =>
      db
        .select()
        .from(SyncQueueTable)
        .where(and(lte(SyncQueueTable.next_retry, now), lt(SyncQueueTable.attempts, maxAttempts)))
        .limit(batchSize)
        .all(),
    )

    if (tasks.length === 0) {
      return
    }

    log.debug("processing retry queue", { count: tasks.length })

    for (const task of tasks) {
      try {
        const payload = JSON.parse(task.payload)

        // 根据类型重新构建完整的同步数据
        let syncPayload: SyncPayload
        if (payload.type === "session") {
          syncPayload = {
            type: "session",
            timestamp: Date.now(),
            data: payload.data,
          }
        } else {
          // 对于消息，需要重新获取最新数据
          const message = await MessageV2.get({
            sessionID: payload.sessionID,
            messageID: payload.messageID,
          })
          syncPayload = {
            type: "message",
            timestamp: Date.now(),
            data: {
              sessionID: payload.sessionID,
              message: {
                id: message.info.id,
                role: message.info.role,
                parentID: message.info.parentID,
                parts: message.parts,
                time: message.info.time,
                usage: message.info.usage,
                finish: message.info.finish,
                summary: message.info.summary,
                error: message.info.error,
              },
            },
          }
        }

        await sendToServer(syncPayload)

        // 成功后从队列中删除
        Database.use((db) => {
          db.delete(SyncQueueTable).where(eq(SyncQueueTable.id, task.id)).run()
        })

        log.debug("retry task succeeded", { taskID: task.id, attempts: task.attempts + 1 })
      } catch (error) {
        // 更新重试次数和错误信息
        const errorMessage = error instanceof Error ? error.message : String(error)
        const newAttempts = task.attempts + 1
        const retryDelay = (config.sync.retryDelay ?? 5000) * Math.pow(2, newAttempts - 1)
        const nextRetry = Date.now() + retryDelay

        Database.use((db) => {
          db.update(SyncQueueTable)
            .set({
              attempts: newAttempts,
              last_error: errorMessage,
              next_retry: nextRetry,
              time_updated: Date.now(),
            })
            .where(eq(SyncQueueTable.id, task.id))
            .run()
        })

        log.debug("retry task failed", {
          taskID: task.id,
          attempts: newAttempts,
          nextRetry,
          error: errorMessage,
        })

        // 如果达到最大重试次数，记录错误
        if (newAttempts >= maxAttempts) {
          log.error("task exceeded max retry attempts", {
            taskID: task.id,
            sessionID: task.session_id,
            eventType: task.event_type,
            attempts: newAttempts,
          })
        }
      }
    }
  }

  /**
   * 停止同步模块（用于测试或关闭）
   */
  export function shutdown(): void {
    const instanceState = state()
    instanceState.retryWorkerRunning = false
    instanceState.initialized = false
    log.info("session sync shutdown")
  }
}
