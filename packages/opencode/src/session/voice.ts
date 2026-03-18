import { Database, and, desc, eq } from "@/storage/db"
import { RequestCurrent } from "@/server/request-current"
import { AccountCurrent } from "@/user/current"
import { UserService } from "@/user/service"
import { Log } from "@/util/log"
import { SessionTable, SessionVoiceTable } from "./session.sql"

const PREFIX = "voice"
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024
export const MAX_DURATION_MS = 60_000
const log = Log.create({ service: "session.voice" })
const DEFAULT_DATA_STATUS = "待标注"
const DEFAULT_ROLE = "一线人员"

let ensure: Promise<void> | undefined

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",")
  if (comma < 0) throw new Error("Invalid audio data URL")

  const header = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (!payload) throw new Error("Audio payload is empty")

  const bytes = header.includes(";base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf-8")

  if (bytes.length === 0) throw new Error("Audio payload is empty")
  return bytes
}

function isMissingTableError(error: unknown) {
  const message = messages(error).join("\n")
  return (
    message.includes("session_voice") &&
    (message.includes("does not exist") || message.includes("undefined_table") || message.includes("no such table"))
  )
}

function messages(error: unknown) {
  const result: string[] = []
  let current = error
  while (current instanceof Error) {
    result.push(current.message)
    current = current.cause
  }
  if (result.length > 0) return result
  return [String(error)]
}

function isSchemaError(error: unknown) {
  const message = messages(error).join("\n")
  return isMissingTableError(error) || message.includes("column \"") || message.includes("no such column")
}

function classify(text?: string) {
  const value = text?.trim()
  if (!value) return "其他"
  if (/(网络|wifi|网线|断网|丢包|延迟|network|timeout)/i.test(value)) return "网络问题"
  if (/(报错|错误|异常|error|failed|failure|code)/i.test(value)) return "软件报错"
  if (/(设备|硬件|机器|主机|终端|故障|损坏|device)/i.test(value)) return "设备故障"
  return "其他"
}

function audit(input: {
  action: string
  result?: "success" | "failed" | "blocked"
  target_id?: string
  detail_json?: Record<string, unknown>
  actor_user_id?: string
}) {
  const actor = AccountCurrent.optional()
  const request = RequestCurrent.optional()
  UserService.auditLater({
    actor_user_id: input.actor_user_id ?? actor?.user_id,
    action: input.action,
    target_type: "session_voice",
    target_id: input.target_id,
    result: input.result ?? "success",
    detail_json: {
      terminal_type: request?.terminal_type ?? "PC",
      operation_time: Date.now(),
      ...input.detail_json,
    },
    ip: request?.ip,
    user_agent: request?.user_agent,
  })
}

async function ensureTable() {
  if (ensure) return ensure
  ensure = (async () => {
    await Database.raw(`
      create table if not exists "session_voice" (
        "id" text primary key,
        "session_id" text not null references "session"("id") on delete cascade,
        "message_id" text not null references "message"("id") on delete cascade,
        "part_id" text not null,
        "user_id" text,
        "product_id" text,
        "role" text,
        "mime" text not null,
        "filename" text not null,
        "duration_ms" bigint,
        "size_bytes" bigint not null,
        "stt_text" text,
        "stt_engine" text,
        "raw_audio" bytea,
        "raw_transcript" text,
        "corrected_transcript" text,
        "transcript_segments" text,
        "session_trace" text,
        "problem_type" text,
        "data_status" text,
        "audio_bytes" bytea not null,
        "time_created" bigint not null,
        "time_updated" bigint not null,
        constraint "session_voice_duration_check" check ("duration_ms" is null or ("duration_ms" >= 0 and "duration_ms" <= 60000)),
        constraint "session_voice_size_check" check ("size_bytes" >= 0 and "size_bytes" <= 3145728)
      )
    `)
    await Database.raw(
      `create index if not exists "session_voice_session_time_idx" on "session_voice" ("session_id", "time_created")`,
    )
    await Database.raw(`create index if not exists "session_voice_message_idx" on "session_voice" ("message_id")`)
    await Database.raw(`create unique index if not exists "session_voice_part_uidx" on "session_voice" ("part_id")`)
    await Database.raw(`alter table "session_voice" add column if not exists "user_id" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "product_id" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "role" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "raw_audio" bytea`)
    await Database.raw(`alter table "session_voice" add column if not exists "raw_transcript" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "corrected_transcript" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "transcript_segments" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "session_trace" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "problem_type" text`)
    await Database.raw(`alter table "session_voice" add column if not exists "data_status" text`)
  })().catch((error) => {
    ensure = undefined
    throw error
  })
  return ensure
}

export namespace SessionVoice {
  export function url(sessionID: string, voiceID: string) {
    return `/session/${sessionID}/voice/${voiceID}`
  }

  export async function saveDataFile(input: {
    id?: string
    session_id: string
    message_id: string
    part_id: string
    mime: string
    filename: string
    duration_ms?: number
    stt_text?: string
    stt_engine?: string
    raw_transcript?: string
    corrected_transcript?: string
    transcript_segments?: Array<{ id: string; start: number; end: number; text: string }>
    session_trace?: Record<string, unknown>
    user_id?: string
    product_id?: string
    role?: string
    problem_type?: string
    data_status?: string
    data_url: string
  }) {
    if (!input.mime.startsWith("audio/")) {
      throw new Error(`Unsupported audio mime type: ${input.mime}`)
    }
    if (input.duration_ms !== undefined && (input.duration_ms < 0 || input.duration_ms > MAX_DURATION_MS)) {
      throw new Error(`Audio duration exceeds max ${MAX_DURATION_MS}ms`)
    }

    const audio_bytes = decodeDataUrl(input.data_url)
    if (audio_bytes.length > MAX_AUDIO_BYTES) {
      throw new Error(`Audio size exceeds max ${MAX_AUDIO_BYTES} bytes`)
    }

    const id = input.id ?? `${PREFIX}_${input.part_id}`
    const now = Date.now()
    const problem_type = input.problem_type?.trim() || classify(input.raw_transcript ?? input.stt_text)
    const data_status = input.data_status?.trim() || DEFAULT_DATA_STATUS
    const role = input.role?.trim() || DEFAULT_ROLE

    const write = () =>
      Database.use(async (db) => {
        const existing = await db.select({ id: SessionVoiceTable.id }).from(SessionVoiceTable).where(eq(SessionVoiceTable.part_id, input.part_id)).get()
        const scope = await db
          .select({
            user_id: SessionTable.user_id,
            product_id: SessionTable.project_id,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.session_id))
          .get()
        const user_id = input.user_id ?? scope?.user_id ?? undefined
        const product_id = input.product_id ?? scope?.product_id ?? undefined
        await db.insert(SessionVoiceTable)
          .values({
            id,
            session_id: input.session_id,
            message_id: input.message_id,
            part_id: input.part_id,
            user_id,
            product_id,
            role,
            mime: input.mime,
            filename: input.filename,
            duration_ms: input.duration_ms,
            size_bytes: audio_bytes.length,
            stt_text: input.stt_text,
            stt_engine: input.stt_engine,
            raw_audio: audio_bytes,
            raw_transcript: input.raw_transcript ?? input.stt_text,
            corrected_transcript: input.corrected_transcript,
            transcript_segments: input.transcript_segments,
            session_trace: input.session_trace,
            problem_type,
            data_status,
            audio_bytes,
            time_created: now,
            time_updated: now,
          })
          .onConflictDoUpdate({
            target: SessionVoiceTable.part_id,
            set: {
              session_id: input.session_id,
              message_id: input.message_id,
              user_id,
              product_id,
              role,
              mime: input.mime,
              filename: input.filename,
              duration_ms: input.duration_ms,
              size_bytes: audio_bytes.length,
              stt_text: input.stt_text,
              stt_engine: input.stt_engine,
              raw_audio: audio_bytes,
              raw_transcript: input.raw_transcript ?? input.stt_text,
              corrected_transcript: input.corrected_transcript,
              transcript_segments: input.transcript_segments,
              session_trace: input.session_trace,
              problem_type,
              data_status,
              audio_bytes,
              time_updated: now,
            },
          })
          .run()

        audit({
          action: existing ? "session.voice.update" : "session.voice.create",
          target_id: id,
          actor_user_id: user_id,
          detail_json: {
            operation_type: existing ? "修改" : "录入",
            session_id: input.session_id,
            message_id: input.message_id,
            part_id: input.part_id,
            user_id,
            product_id,
            role,
            problem_type,
            data_status,
          },
        })
      })

    try {
      await write()
    } catch (error) {
      if (!isSchemaError(error)) throw error
      log.warn("session_voice table missing, creating fallback table", { error, session_id: input.session_id })
      await ensureTable()
      await write()
    }

    return {
      id,
      size_bytes: audio_bytes.length,
    }
  }

  export async function get(input: { session_id: string; voice_id: string }) {
    const read = () =>
      Database.use((db) =>
        db
          .select()
          .from(SessionVoiceTable)
          .where(and(eq(SessionVoiceTable.id, input.voice_id), eq(SessionVoiceTable.session_id, input.session_id)))
          .get(),
      )

    try {
      return await read()
    } catch (error) {
      if (!isSchemaError(error)) throw error
      await ensureTable()
      return read()
    }
  }

  export async function latestByMessage(input: { session_id: string; message_id: string }) {
    const read = () =>
      Database.use((db) =>
        db
          .select({
            id: SessionVoiceTable.id,
            part_id: SessionVoiceTable.part_id,
            raw_transcript: SessionVoiceTable.raw_transcript,
            corrected_transcript: SessionVoiceTable.corrected_transcript,
          })
          .from(SessionVoiceTable)
          .where(and(eq(SessionVoiceTable.session_id, input.session_id), eq(SessionVoiceTable.message_id, input.message_id)))
          .orderBy(desc(SessionVoiceTable.time_created))
          .get(),
      )

    try {
      return await read()
    } catch (error) {
      if (!isSchemaError(error)) throw error
      await ensureTable()
      return read()
    }
  }

  export async function setCorrectedTranscript(input: {
    session_id: string
    message_id: string
    part_id: string
    corrected_transcript: string
  }) {
    const now = Date.now()
    const actor = AccountCurrent.optional()
    const write = () =>
      Database.use((db) =>
        db
          .update(SessionVoiceTable)
          .set({
            corrected_transcript: input.corrected_transcript,
            time_updated: now,
          })
          .where(
            and(
              eq(SessionVoiceTable.session_id, input.session_id),
              eq(SessionVoiceTable.message_id, input.message_id),
              eq(SessionVoiceTable.part_id, input.part_id),
            ),
          )
          .run(),
      )

    try {
      await write()
    } catch (error) {
      if (!isSchemaError(error)) throw error
      await ensureTable()
      await write()
    }

    audit({
      action: "session.voice.transcript.update",
      target_id: input.part_id,
      actor_user_id: actor?.user_id,
      detail_json: {
        operation_type: "修改",
        session_id: input.session_id,
        message_id: input.message_id,
        part_id: input.part_id,
      },
    })
  }

  export async function removeByPart(input: {
    session_id: string
    message_id: string
    part_id: string
  }) {
    const actor = AccountCurrent.optional()
    await ensureTable()
    const row = await Database.use((db) =>
      db
        .select({
          id: SessionVoiceTable.id,
          user_id: SessionVoiceTable.user_id,
          product_id: SessionVoiceTable.product_id,
          role: SessionVoiceTable.role,
          problem_type: SessionVoiceTable.problem_type,
          data_status: SessionVoiceTable.data_status,
        })
        .from(SessionVoiceTable)
        .where(
          and(
            eq(SessionVoiceTable.session_id, input.session_id),
            eq(SessionVoiceTable.message_id, input.message_id),
            eq(SessionVoiceTable.part_id, input.part_id),
          ),
        )
        .get(),
    )
    if (!row) return

    const write = () =>
      Database.use((db) =>
        db
          .delete(SessionVoiceTable)
          .where(
            and(
              eq(SessionVoiceTable.session_id, input.session_id),
              eq(SessionVoiceTable.message_id, input.message_id),
              eq(SessionVoiceTable.part_id, input.part_id),
            ),
          )
          .run(),
      )

    try {
      await write()
    } catch (error) {
      if (!isSchemaError(error)) throw error
      await ensureTable()
      await write()
    }

    audit({
      action: "session.voice.delete",
      target_id: row.id,
      actor_user_id: actor?.user_id ?? row.user_id ?? undefined,
      detail_json: {
        operation_type: "删除",
        session_id: input.session_id,
        message_id: input.message_id,
        part_id: input.part_id,
        user_id: row.user_id,
        product_id: row.product_id,
        role: row.role,
        problem_type: row.problem_type,
        data_status: row.data_status,
      },
    })
  }
}
