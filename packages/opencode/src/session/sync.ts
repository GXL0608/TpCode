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
  type SessionVisibility = "private" | "department" | "org" | "public"

  type SessionAccountSnapshot = {
    user_id: string | null
    org_id: string | null
    department_id: string | null
    visibility: SessionVisibility
  }

  const state = Instance.state(() => ({
    initialized: false,
    retryWorkerRunning: false,
    replayingSessions: new Set<string>(),
    replayRequestedSessions: new Set<string>(),
    lastPayloadHashByEntity: new Map<string, string>(),
    sessionAccountByID: new Map<string, SessionAccountSnapshot>(),
  }))

  /**
   * sync-server /api/sync contract:
   * - session.data must include user_id/org_id/department_id/visibility keys (nullable except visibility)
   * - message.data must include sessionID + message (+ parts)
   */
  interface SyncPayload {
    type: "session" | "message"
    timestamp: number
    data: any
  }

  const FULL_SYNC_SCOPE = "default"
  const SESSION_ACCOUNT_SCOPE = "session-account-v1"
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
    await runSessionAccountBackfillIfNeeded(initialFullSyncBatchSize)

    // 订阅会话事件
    log.info("subscribing to session events")
    const sub1 = Bus.subscribe(Session.Event.Created, (event) => {
      log.info("session.created event received", { sessionID: event.properties.info.id })
      void handleSessionEvent("session.created", event.properties.info, { forceRefresh: true }).catch((err) => {
        log.error("error handling session.created", { error: err })
      })
    })
    log.info("session.created subscription created", { hasSubscription: !!sub1 })

    const sub2 = Bus.subscribe(Session.Event.Updated, (event) => {
      log.info("session.updated event received", { sessionID: event.properties.info.id })
      void handleSessionEvent("session.updated", event.properties.info, { forceRefresh: true }).catch((err) => {
        log.error("error handling session.updated", { error: err })
      })
    })
    log.info("session.updated subscription created", { hasSubscription: !!sub2 })

    const sub6 = Bus.subscribe(Session.Event.Deleted, async (event) => {
      const sessionID = event.properties.info.id
      const instanceState = state()
      instanceState.sessionAccountByID.delete(sessionID)
      instanceState.lastPayloadHashByEntity.delete(sessionEntityKey(sessionID))
      instanceState.replayingSessions.delete(sessionID)
      instanceState.replayRequestedSessions.delete(sessionID)
    })
    log.info("session.deleted subscription created", { hasSubscription: !!sub6 })

    // 订阅消息事件
    log.info("subscribing to message events")
    const sub3 = Bus.subscribe(MessageV2.Event.Updated, (event) => {
      log.info("message.updated event received", { sessionID: event.properties.info.sessionID, messageID: event.properties.info.id })
      void handleMessageEvent(event.properties.info.sessionID, event.properties.info.id).catch((err) => {
        log.error("error handling message.updated", { error: err })
      })
    })
    log.info("message.updated subscription created", { hasSubscription: !!sub3 })

    // 订阅消息 part 事件，确保 reasoning/tool 等内容变化能被完整同步
    const sub4 = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
      const { sessionID, messageID, id, type } = event.properties.part
      log.info("message.part.updated event received", { sessionID, messageID, partID: id, partType: type })
      void handleMessageEvent(sessionID, messageID).catch((err) => {
        log.error("error handling message.part.updated", { error: err })
      })
    })
    log.info("message.part.updated subscription created", { hasSubscription: !!sub4 })

    const sub5 = Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
      log.info("message.part.removed event received", {
        sessionID: event.properties.sessionID,
        messageID: event.properties.messageID,
        partID: event.properties.partID,
      })
      void handleMessageEvent(event.properties.sessionID, event.properties.messageID).catch((err) => {
        log.error("error handling message.part.removed", { error: err })
      })
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
  async function handleSessionEvent(
    eventType: string,
    sessionInfo: Session.Info,
    options?: { forceRefresh?: boolean },
  ): Promise<void> {
    try {
      await sendToServer(await toSessionPayload(sessionInfo, options))
      log.debug("session synced successfully", { sessionID: sessionInfo.id, eventType })
    } catch (error) {
      log.warn("failed to sync session", { sessionID: sessionInfo.id, error })
      await enqueueRetry(eventType, sessionInfo.id, { type: "session", sessionID: sessionInfo.id }, error)
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
      await sendToServer(await toSessionPayload(sessionInfo))
    } catch (error) {
      await enqueueRetry("session.replay", sessionID, { type: "session", sessionID }, error)
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

  function sessionEntityKey(sessionID: string) {
    return `session:${sessionID}`
  }

  async function sessionAccountFromDB(sessionID: string): Promise<SessionAccountSnapshot> {
    const row = await Database.use((db) =>
      db
        .select({
          user_id: SessionTable.user_id,
          org_id: SessionTable.org_id,
          department_id: SessionTable.department_id,
          visibility: SessionTable.visibility,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get(),
    )

    const visibility =
      row?.visibility === "private" ||
      row?.visibility === "department" ||
      row?.visibility === "org" ||
      row?.visibility === "public"
        ? row.visibility
        : "public"

    return {
      user_id: row?.user_id ?? null,
      org_id: row?.org_id ?? null,
      department_id: row?.department_id ?? null,
      visibility,
    }
  }

  async function sessionAccount(sessionID: string, options?: { forceRefresh?: boolean }): Promise<SessionAccountSnapshot> {
    const instanceState = state()
    const forceRefresh = options?.forceRefresh === true
    const cached = instanceState.sessionAccountByID.get(sessionID)

    if (!forceRefresh && cached) {
      return cached
    }

    try {
      const value = await sessionAccountFromDB(sessionID)
      instanceState.sessionAccountByID.set(sessionID, value)
      return value
    } catch (error) {
      if (cached) {
        log.warn("session account query failed, fallback to cached snapshot", { sessionID, error })
        return cached
      }
      throw error
    }
  }

  async function toSessionPayload(sessionInfo: Session.Info, options?: { forceRefresh?: boolean }): Promise<SyncPayload> {
    const account = await sessionAccount(sessionInfo.id, options)
    return buildSessionPayloadForAccount(sessionInfo, account)
  }

  async function buildSessionPayload(sessionID: string): Promise<SyncPayload> {
    return toSessionPayload(await Session.get(sessionID))
  }

  function toMessagePayload(sessionID: string, message: any): SyncPayload {
    return buildMessagePayloadForTesting(sessionID, message)
  }

  /** @internal Exported for testing */
  export function buildSessionPayloadForAccount(
    sessionInfo: Session.Info,
    account: SessionAccountSnapshot,
    timestamp = Date.now(),
  ): SyncPayload {
    return {
      type: "session",
      timestamp,
      // Keep full session info to avoid dropping fields (share/revert/permission/archived...)
      data: {
        ...sessionInfo,
        user_id: account.user_id,
        org_id: account.org_id,
        department_id: account.department_id,
        visibility: account.visibility,
      },
    }
  }

  /** @internal Exported for testing */
  export function buildMessagePayloadForTesting(sessionID: string, message: any, timestamp = Date.now()): SyncPayload {
    const info = message.info ?? {}
    const { sessionID: _ignoredSessionID, ...messageInfo } = info
    return {
      type: "message",
      timestamp,
      data: {
        sessionID,
        // Keep full message info + parts to preserve thinking/tool/model metadata.
        message: { ...messageInfo, parts: message.parts },
      },
    }
  }

  function decodeRetryPayload(raw: unknown): any {
    if (typeof raw === "string") return JSON.parse(raw)
    if (raw && typeof raw === "object") return raw
    throw new Error(`invalid retry payload type: ${typeof raw}`)
  }

  /** @internal Exported for testing */
  export function parseRetryPayloadForTesting(raw: unknown) {
    return decodeRetryPayload(raw)
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
      if (await hasCompletedInitialFullSync()) {
        log.info("initial full sync already completed, skipping startup backfill")
        return
      }
    } catch (error) {
      log.warn("failed to read initial full sync marker, fallback to startup backfill", { error })
    }

    log.info("initial full sync marker missing, running one-time backfill", { batchSize })
    await runInitialFullSync(batchSize)
    try {
      await markInitialFullSyncCompleted()
      log.info("initial full sync completed and marked")
    } catch (error) {
      log.error("initial full sync finished but failed to write marker", { error })
    }
  }

  async function hasCompletedInitialFullSync(): Promise<boolean> {
    return hasCompletedSyncScope(FULL_SYNC_SCOPE)
  }

  async function markInitialFullSyncCompleted(): Promise<void> {
    await markSyncScopeCompleted(FULL_SYNC_SCOPE)
  }

  async function hasCompletedSessionAccountBackfill(): Promise<boolean> {
    return hasCompletedSyncScope(SESSION_ACCOUNT_SCOPE)
  }

  async function markSessionAccountBackfillCompleted(): Promise<void> {
    await markSyncScopeCompleted(SESSION_ACCOUNT_SCOPE)
  }

  async function hasCompletedSyncScope(scope: string): Promise<boolean> {
    const row = await Database.use((db) =>
      db
        .select({ fullSyncCompletedAt: SyncStateTable.full_sync_completed_at })
        .from(SyncStateTable)
        .where(eq(SyncStateTable.scope, scope))
        .get(),
    )

    return typeof row?.fullSyncCompletedAt === "number" && row.fullSyncCompletedAt > 0
  }

  async function markSyncScopeCompleted(scope: string): Promise<void> {
    const now = Date.now()
    await Database.use(async (db) => {
      await db.insert(SyncStateTable)
        .values({
          scope,
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
      const sessionIDs = await Database.use((db) =>
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
          await sendToServer(await toSessionPayload(sessionInfo))
          sessionsSynced += 1
        } catch (error) {
          await enqueueRetry("session.full-sync", row.id, { type: "session", sessionID: row.id }, error)
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

  async function runSessionAccountBackfillIfNeeded(batchSize: number): Promise<void> {
    try {
      if (await hasCompletedSessionAccountBackfill()) {
        log.info("session account backfill already completed, skipping")
        return
      }
    } catch (error) {
      log.warn("failed to read session account backfill marker, fallback to account backfill", { error })
    }

    log.info("session account backfill marker missing, running one-time session-only backfill", { batchSize })
    await runSessionAccountBackfill(batchSize)
    try {
      await markSessionAccountBackfillCompleted()
      log.info("session account backfill completed and marked")
    } catch (error) {
      log.error("session account backfill finished but failed to write marker", { error })
    }
  }

  async function runSessionAccountBackfill(batchSize: number): Promise<void> {
    let offset = 0
    let sessionsSynced = 0

    log.info("session account backfill started", { batchSize })

    while (true) {
      const sessionIDs = await Database.use((db) =>
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
        try {
          const payload = await buildSessionPayload(row.id)
          await sendToServer(payload)
          sessionsSynced += 1
        } catch (error) {
          await enqueueRetry("session.account-backfill", row.id, { type: "session", sessionID: row.id }, error)
        }
      }

      offset += sessionIDs.length
      if (sessionIDs.length < batchSize) break
    }

    log.info("session account backfill finished", { batchSize, sessionsSynced })
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
      await Database.use(async (db) => {
        await db.insert(SyncQueueTable)
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

    const tasks = await Database.use((db) =>
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
        const payload = decodeRetryPayload(task.payload)

        // 根据类型重新构建完整的同步数据
        let syncPayload: SyncPayload
        if (payload.type === "session") {
          const sessionID = payload.sessionID ?? task.session_id
          syncPayload = await buildSessionPayload(sessionID)
        } else if (payload.type === "session-replay") {
          await replaySessionHistory(payload.sessionID ?? task.session_id, "retry")
          await Database.use(async (db) => {
            await db.delete(SyncQueueTable).where(eq(SyncQueueTable.id, task.id)).run()
          })
          log.debug("session replay retry task succeeded", { taskID: task.id, sessionID: task.session_id })
          continue
        } else {
          // 对于消息，需要重新获取最新数据
          const sessionID = payload.sessionID ?? task.session_id
          const message = await MessageV2.get({
            sessionID,
            messageID: payload.messageID,
          })
          syncPayload = toMessagePayload(sessionID, message)
        }

        await sendToServer(syncPayload)

        // 成功后从队列中删除
        await Database.use(async (db) => {
          await db.delete(SyncQueueTable).where(eq(SyncQueueTable.id, task.id)).run()
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

        await Database.use(async (db) => {
          await db.update(SyncQueueTable)
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
    instanceState.lastPayloadHashByEntity.clear()
    instanceState.sessionAccountByID.clear()
    instanceState.initialized = false
    log.info("session sync shutdown")
  }
}
