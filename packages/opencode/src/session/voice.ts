import { Database, and, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { SessionVoiceTable } from "./session.sql"

const PREFIX = "voice"
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024
export const MAX_DURATION_MS = 60_000
const log = Log.create({ service: "session.voice" })

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
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("session_voice") &&
    (message.includes("does not exist") || message.includes("undefined_table") || message.includes("no such table"))
  )
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
        "mime" text not null,
        "filename" text not null,
        "duration_ms" bigint,
        "size_bytes" bigint not null,
        "stt_text" text,
        "stt_engine" text,
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

    const write = () =>
      Database.use(async (db) => {
        await db.insert(SessionVoiceTable)
          .values({
            id,
            session_id: input.session_id,
            message_id: input.message_id,
            part_id: input.part_id,
            mime: input.mime,
            filename: input.filename,
            duration_ms: input.duration_ms,
            size_bytes: audio_bytes.length,
            stt_text: input.stt_text,
            stt_engine: input.stt_engine,
            audio_bytes,
            time_created: now,
            time_updated: now,
          })
          .onConflictDoUpdate({
            target: SessionVoiceTable.part_id,
            set: {
              session_id: input.session_id,
              message_id: input.message_id,
              mime: input.mime,
              filename: input.filename,
              duration_ms: input.duration_ms,
              size_bytes: audio_bytes.length,
              stt_text: input.stt_text,
              stt_engine: input.stt_engine,
              audio_bytes,
              time_updated: now,
            },
          })
          .run()
      })

    try {
      await write()
    } catch (error) {
      if (!isMissingTableError(error)) throw error
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
      if (!isMissingTableError(error)) throw error
      await ensureTable()
      return read()
    }
  }
}
