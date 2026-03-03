import { and, asc, Database, eq, gt } from "@/storage/db"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { TpUserTable } from "@/user/user.sql"
import { TpTokenUsageTable } from "./token-usage.sql"
import { MessageV2 } from "@/session/message-v2"

type UsageTokens = {
  total?: number
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

type SessionContext = {
  sessionID: string
  projectID: string
  workplace: string
  userID?: string
  username?: string
  phone?: string
  displayName?: string
  accountType?: string
  orgID?: string
  departmentID?: string
}

const log = Log.create({ service: "token.usage" })

function safeInt(input: number | undefined | null) {
  if (!Number.isFinite(input)) return 0
  return Math.max(0, Math.trunc(input as number))
}

function toTotal(tokens: UsageTokens) {
  const provided = safeInt(tokens.total)
  if (provided > 0) return provided
  return (
    safeInt(tokens.input) +
    safeInt(tokens.output) +
    safeInt(tokens.reasoning) +
    safeInt(tokens.cache.read) +
    safeInt(tokens.cache.write)
  )
}

function toCostMicros(cost: number) {
  if (!Number.isFinite(cost)) return 0
  return Math.max(0, Math.round(cost * 1_000_000))
}

async function sessionContext(sessionID: string): Promise<SessionContext | undefined> {
  const row = await Database.use((db) =>
    db
      .select({
        sessionID: SessionTable.id,
        projectID: SessionTable.project_id,
        workplace: SessionTable.directory,
        userID: SessionTable.user_id,
        orgID: SessionTable.org_id,
        departmentID: SessionTable.department_id,
        username: TpUserTable.username,
        phone: TpUserTable.phone,
        displayName: TpUserTable.display_name,
        accountType: TpUserTable.account_type,
      })
      .from(SessionTable)
      .leftJoin(TpUserTable, eq(TpUserTable.id, SessionTable.user_id))
      .where(eq(SessionTable.id, sessionID))
      .get(),
  )
  if (!row) return
  return {
    sessionID: row.sessionID,
    projectID: row.projectID,
    workplace: row.workplace,
    userID: row.userID ?? undefined,
    username: row.username ?? undefined,
    phone: row.phone ?? undefined,
    displayName: row.displayName ?? undefined,
    accountType: row.accountType ?? undefined,
    orgID: row.orgID ?? undefined,
    departmentID: row.departmentID ?? undefined,
  }
}

export namespace TokenUsageService {
  export async function recordStepFinish(input: {
    part: MessageV2.StepFinishPart
    persistedAt?: number
  }) {
    const [ctx, msg] = await Promise.all([
      sessionContext(input.part.sessionID),
      Database.use((db) =>
        db
          .select({ data: MessageTable.data })
          .from(MessageTable)
          .where(and(eq(MessageTable.id, input.part.messageID), eq(MessageTable.session_id, input.part.sessionID)))
          .get(),
      ),
    ])
    if (!ctx) return
    const data = msg?.data
    if (!data || data.role !== "assistant") {
      log.warn("skip usage record because message is missing or not assistant", {
        sessionID: input.part.sessionID,
        messageID: input.part.messageID,
        partID: input.part.id,
      })
      return
    }
    const assistantData = data as unknown as {
      role: "assistant"
      providerID: string
      modelID: string
    }
    const now = input.persistedAt ?? Date.now()
    const sourceScene = "step_finish" as const
    await Database.use(async (db) => {
      await db.insert(TpTokenUsageTable)
        .values({
          id: ulid(),
          usage_scene: sourceScene,
          source_id: input.part.id,
          session_id: ctx.sessionID,
          message_id: input.part.messageID,
          project_id: ctx.projectID,
          workplace: ctx.workplace,
          user_id: ctx.userID,
          username: ctx.username,
          phone: ctx.phone,
          display_name: ctx.displayName,
          account_type: ctx.accountType,
          org_id: ctx.orgID,
          department_id: ctx.departmentID,
          provider_id: assistantData.providerID,
          model_id: assistantData.modelID,
          token_input: safeInt(input.part.tokens.input),
          token_output: safeInt(input.part.tokens.output),
          token_reasoning: safeInt(input.part.tokens.reasoning),
          token_cache_read: safeInt(input.part.tokens.cache.read),
          token_cache_write: safeInt(input.part.tokens.cache.write),
          token_total: toTotal(input.part.tokens),
          cost_micros: toCostMicros(input.part.cost),
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [TpTokenUsageTable.usage_scene, TpTokenUsageTable.source_id],
          set: {
            session_id: ctx.sessionID,
            message_id: input.part.messageID,
            project_id: ctx.projectID,
            workplace: ctx.workplace,
            user_id: ctx.userID,
            username: ctx.username,
            phone: ctx.phone,
            display_name: ctx.displayName,
            account_type: ctx.accountType,
            org_id: ctx.orgID,
            department_id: ctx.departmentID,
            provider_id: assistantData.providerID,
            model_id: assistantData.modelID,
            token_input: safeInt(input.part.tokens.input),
            token_output: safeInt(input.part.tokens.output),
            token_reasoning: safeInt(input.part.tokens.reasoning),
            token_cache_read: safeInt(input.part.tokens.cache.read),
            token_cache_write: safeInt(input.part.tokens.cache.write),
            token_total: toTotal(input.part.tokens),
            cost_micros: toCostMicros(input.part.cost),
            time_updated: now,
          },
        })
        .run()
    })
  }

  export async function recordAutoTitle(input: {
    sessionID: string
    messageID: string
    providerID: string
    modelID: string
    tokens: UsageTokens
    cost: number
    sourceID?: string
    persistedAt?: number
  }) {
    const ctx = await sessionContext(input.sessionID)
    if (!ctx) return
    const now = input.persistedAt ?? Date.now()
    const scene = "auto_title" as const
    await Database.use(async (db) => {
      await db.insert(TpTokenUsageTable)
        .values({
          id: ulid(),
          usage_scene: scene,
          source_id: input.sourceID ?? ulid(),
          session_id: ctx.sessionID,
          message_id: input.messageID,
          project_id: ctx.projectID,
          workplace: ctx.workplace,
          user_id: ctx.userID,
          username: ctx.username,
          phone: ctx.phone,
          display_name: ctx.displayName,
          account_type: ctx.accountType,
          org_id: ctx.orgID,
          department_id: ctx.departmentID,
          provider_id: input.providerID,
          model_id: input.modelID,
          token_input: safeInt(input.tokens.input),
          token_output: safeInt(input.tokens.output),
          token_reasoning: safeInt(input.tokens.reasoning),
          token_cache_read: safeInt(input.tokens.cache.read),
          token_cache_write: safeInt(input.tokens.cache.write),
          token_total: toTotal(input.tokens),
          cost_micros: toCostMicros(input.cost),
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [TpTokenUsageTable.usage_scene, TpTokenUsageTable.source_id],
          set: {
            session_id: ctx.sessionID,
            message_id: input.messageID,
            project_id: ctx.projectID,
            workplace: ctx.workplace,
            user_id: ctx.userID,
            username: ctx.username,
            phone: ctx.phone,
            display_name: ctx.displayName,
            account_type: ctx.accountType,
            org_id: ctx.orgID,
            department_id: ctx.departmentID,
            provider_id: input.providerID,
            model_id: input.modelID,
            token_input: safeInt(input.tokens.input),
            token_output: safeInt(input.tokens.output),
            token_reasoning: safeInt(input.tokens.reasoning),
            token_cache_read: safeInt(input.tokens.cache.read),
            token_cache_write: safeInt(input.tokens.cache.write),
            token_total: toTotal(input.tokens),
            cost_micros: toCostMicros(input.cost),
            time_updated: now,
          },
        })
        .run()
    })
  }

  export async function backfillStepFinish(input?: { batchSize?: number }) {
    const batchSize = Math.max(1, Math.min(input?.batchSize ?? 500, 5000))
    let scanned = 0
    let written = 0
    let failed = 0
    let cursor: string | undefined

    while (true) {
      const rows = await Database.use((db) => {
        const query = db
          .select({
            id: PartTable.id,
            messageID: PartTable.message_id,
            sessionID: PartTable.session_id,
            data: PartTable.data,
            timeCreated: PartTable.time_created,
          })
          .from(PartTable)
          .orderBy(asc(PartTable.id))
          .limit(batchSize)
        return cursor ? query.where(gt(PartTable.id, cursor)).all() : query.all()
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1]!.id
      scanned += rows.length

      for (const row of rows) {
        const data = row.data as Record<string, unknown> | undefined
        if (!data || data.type !== "step-finish") continue
        const parsed = MessageV2.StepFinishPart.safeParse({
          id: row.id,
          messageID: row.messageID,
          sessionID: row.sessionID,
          ...data,
        })
        if (!parsed.success) {
          failed += 1
          continue
        }
        try {
          await recordStepFinish({
            part: parsed.data,
            persistedAt: row.timeCreated,
          })
          written += 1
        } catch (error) {
          failed += 1
          log.warn("failed to backfill one token usage row", {
            error,
            partID: row.id,
            sessionID: row.sessionID,
            messageID: row.messageID,
          })
        }
      }
    }

    return {
      scanned,
      written,
      failed,
    }
  }
}
