import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Database, eq, and, lte, lt, desc } from "@/storage/db"
import { SyncQueueTable, SyncStateTable, SessionTable } from "./session.sql"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { createHash } from "crypto"

const log = Log.create({ service: "sync" })

export namespace SessionSync {
  const state = Instance.state(() => ({
    initialized: false,
    retryWorkerRunning: false,
    replayingSessions: new Set<string>(),
    replayRequestedSessions: new Set<string>(),
    lastPayloadHashByEntity: new Map<string, string>(),
  }))

  interface SyncPayload {
    type: "session" | "message"
    timestamp: number
    data: any
  }

  const FULL_SYNC_SCOPE = "default"
  const DEFAULT_INITIAL_FULL_SYNC_BATCH_SIZE = 25
  const MAX_RETRY_DELAY_MS = 5 * 60 * 1000
  const MAX_BACKOFF_EXPONENT = 8

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

    const initialFullSyncBatchSize = config.sync.backfillBatchSize ?? DEFAULT_INITIAL_FULL_SYNC_BATCH_SIZE

    log.info("initializing session sync", {
      endpoint: config.sync.endpoint,
      initialFullSyncBatchSize,
      retryAttempts: config.sync.retryAttempts,
    })

    await runInitialFullSyncIfNeeded(initialFullSyncBatchSize)

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

    // 订阅消息 part 事件，确保 reasoning/tool 等内容变化能被完整同步
    const sub4 = Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const { sessionID, messageID, id, type } = event.properties.part
      log.info("message.part.updated event received", { sessionID, messageID, partID: id, partType: type })
      try {
        await handleMessageEvent(sessionID, messageID)
      } catch (err) {
        log.error("error handling message.part.updated", { error: err })
      }
    })
    log.info("message.part.updated subscription created", { hasSubscription: !!sub4 })

    const sub5 = Bus.subscribe(MessageV2.Event.PartRemoved, async (event) => {
      log.info("message.part.removed event received", {
        sessionID: event.properties.sessionID,
        messageID: event.properties.messageID,
        partID: event.properties.partID,
      })
      try {
        await handleMessageEvent(event.properties.sessionID, event.properties.messageID)
      } catch (err) {
        log.error("error handling message.part.removed", { error: err })
      }
    })
    log.info("message.part.removed subscription created", { hasSubscription: !!sub5 })

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
      await sendToServer(toSessionPayload(sessionInfo))
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
      await replaySessionHistory(sessionID, `message-event:${messageID}`)
      log.debug("session history replayed after message event", { sessionID, messageID })
    } catch (error) {
      log.warn("failed to replay session history after message event", { sessionID, messageID, error })
      await enqueueRetry("session.replay", sessionID, { type: "session-replay", sessionID }, error)
    }
  }

  async function replaySessionHistory(sessionID: string, reason: string): Promise<void> {
    const instanceState = state()
    if (instanceState.replayingSessions.has(sessionID)) {
      instanceState.replayRequestedSessions.add(sessionID)
      log.debug("session replay already running, queued one more pass", { sessionID, reason })
      return
    }

    instanceState.replayingSessions.add(sessionID)
    try {
      do {
        instanceState.replayRequestedSessions.delete(sessionID)
        await runSessionHistoryReplay(sessionID, reason)
      } while (instanceState.replayRequestedSessions.has(sessionID))
    } finally {
      instanceState.replayingSessions.delete(sessionID)
      instanceState.replayRequestedSessions.delete(sessionID)
    }
  }

  async function runSessionHistoryReplay(sessionID: string, reason: string): Promise<void> {
    let messageCount = 0
    const sessionInfo = await Session.get(sessionID)

    try {
      await sendToServer(toSessionPayload(sessionInfo))
    } catch (error) {
      await enqueueRetry("session.replay", sessionID, { type: "session", data: sessionInfo }, error)
    }

    for await (const message of MessageV2.stream(sessionID)) {
      try {
        await sendToServer(toMessagePayload(sessionID, message))
        messageCount += 1
      } catch (error) {
        await enqueueRetry("message.replay", sessionID, { type: "message", sessionID, messageID: message.info.id }, error)
      }
    }

    log.info("session history replay finished", { sessionID, reason, messageCount })
  }

  function toSessionPayload(sessionInfo: Session.Info): SyncPayload {
    return {
      type: "session",
      timestamp: Date.now(),
      // Keep full session info to avoid dropping fields (share/revert/permission/archived...)
      data: sessionInfo,
    }
  }

  function toMessagePayload(sessionID: string, message: any): SyncPayload {
    const info = message.info ?? {}
    const { sessionID: _ignoredSessionID, ...messageInfo } = info
    return {
      type: "message",
      timestamp: Date.now(),
      data: {
        sessionID,
        // Keep full message info + parts to preserve thinking/tool/model metadata.
        message: { ...messageInfo, parts: message.parts },
      },
    }
  }

  function payloadEntityKey(payload: SyncPayload): string | undefined {
    if (payload.type === "session") {
      const sessionID = payload.data?.id
      if (typeof sessionID === "string" && sessionID.length > 0) {
        return `session:${sessionID}`
      }
      return
    }

    const sessionID = payload.data?.sessionID
    const messageID = payload.data?.message?.id
    if (typeof sessionID === "string" && typeof messageID === "string" && sessionID.length > 0 && messageID.length > 0) {
      return `message:${sessionID}:${messageID}`
    }
  }

  function payloadHash(payload: SyncPayload): string {
    return createHash("sha256").update(payload.type).update("\n").update(JSON.stringify(payload.data)).digest("hex")
  }

  async function runInitialFullSyncIfNeeded(batchSize: number): Promise<void> {
    try {
      if (hasCompletedInitialFullSync()) {
        log.info("initial full sync already completed, skipping startup backfill")
        return
      }
    } catch (error) {
      log.warn("failed to read initial full sync marker, fallback to startup backfill", { error })
    }

    log.info("initial full sync marker missing, running one-time backfill", { batchSize })
    await runInitialFullSync(batchSize)
    try {
      markInitialFullSyncCompleted()
      log.info("initial full sync completed and marked")
    } catch (error) {
      log.error("initial full sync finished but failed to write marker", { error })
    }
  }

  function hasCompletedInitialFullSync(): boolean {
    const row = Database.use((db) =>
      db
        .select({ fullSyncCompletedAt: SyncStateTable.full_sync_completed_at })
        .from(SyncStateTable)
        .where(eq(SyncStateTable.scope, FULL_SYNC_SCOPE))
        .get(),
    )

    return typeof row?.fullSyncCompletedAt === "number" && row.fullSyncCompletedAt > 0
  }

  function markInitialFullSyncCompleted(): void {
    const now = Date.now()
    Database.use((db) => {
      db.insert(SyncStateTable)
        .values({
          scope: FULL_SYNC_SCOPE,
          full_sync_completed_at: now,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SyncStateTable.scope,
          set: {
            full_sync_completed_at: now,
            time_updated: now,
          },
        })
        .run()
    })
  }

  async function runInitialFullSync(batchSize: number): Promise<void> {
    let offset = 0
    let sessionsSynced = 0
    let messagesSynced = 0

    log.info("initial full sync started", { batchSize })

    while (true) {
      const sessionIDs = Database.use((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.project_id, Instance.project.id))
          .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
          .limit(batchSize)
          .offset(offset)
          .all(),
      )

      if (sessionIDs.length === 0) break

      for (const row of sessionIDs) {
        let sessionInfo: Session.Info
        try {
          sessionInfo = await Session.get(row.id)
        } catch (error) {
          log.warn("skipping full sync for missing session", { sessionID: row.id, error })
          continue
        }

        try {
          await sendToServer(toSessionPayload(sessionInfo))
          sessionsSynced += 1
        } catch (error) {
          await enqueueRetry("session.full-sync", row.id, { type: "session", data: sessionInfo }, error)
        }

        for await (const message of MessageV2.stream(row.id)) {
          try {
            await sendToServer(toMessagePayload(row.id, message))
            messagesSynced += 1
          } catch (error) {
            await enqueueRetry(
              "message.full-sync",
              row.id,
              { type: "message", sessionID: row.id, messageID: message.info.id },
              error,
            )
          }
        }
      }

      offset += sessionIDs.length
      if (sessionIDs.length < batchSize) break
    }

    log.info("initial full sync finished", { batchSize, sessionsSynced, messagesSynced })
  }

  /**
   * 发送数据到中心服务器
   */
  async function sendToServer(payload: SyncPayload): Promise<void> {
    const config = await Config.state().then((s) => s.config)
    const instanceState = state()

    if (!config.sync?.enabled) {
      throw new Error("Sync is not enabled")
    }

    const entityKey = payloadEntityKey(payload)
    const nextHash = entityKey ? payloadHash(payload) : undefined
    if (entityKey && nextHash && instanceState.lastPayloadHashByEntity.get(entityKey) === nextHash) {
      log.debug("skip duplicate sync payload", { type: payload.type, entityKey })
      return
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

      if (entityKey && nextHash) {
        instanceState.lastPayloadHashByEntity.set(entityKey, nextHash)
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
            id: Identifier.ascending("session"),
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
    const batchSize = config.sync.batchSize ?? 10
    const maxAttempts = config.sync.retryAttempts ?? 5

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
        } else if (payload.type === "session-replay") {
          await replaySessionHistory(payload.sessionID ?? task.session_id, "retry")
          Database.use((db) => {
            db.delete(SyncQueueTable).where(eq(SyncQueueTable.id, task.id)).run()
          })
          log.debug("session replay retry task succeeded", { taskID: task.id, sessionID: task.session_id })
          continue
        } else {
          // 对于消息，需要重新获取最新数据
          const message = await MessageV2.get({
            sessionID: payload.sessionID,
            messageID: payload.messageID,
          })
          syncPayload = toMessagePayload(payload.sessionID, message)
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
        const baseRetryDelay = config.sync.retryDelay ?? 5000
        const exponent = Math.min(newAttempts - 1, MAX_BACKOFF_EXPONENT)
        const retryDelay = Math.min(baseRetryDelay * Math.pow(2, exponent), MAX_RETRY_DELAY_MS)
        const nextRetry = newAttempts >= maxAttempts ? null : Date.now() + retryDelay

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

        if (newAttempts >= maxAttempts) {
          log.error("retry task stopped after reaching max attempts", {
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
    instanceState.replayingSessions.clear()
    instanceState.replayRequestedSessions.clear()
    instanceState.initialized = false
    log.info("session sync shutdown")
  }
}
