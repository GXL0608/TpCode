import { Database, and, eq } from "@/storage/db"
import { SessionVoiceTable } from "./session.sql"

const PREFIX = "voice"
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024
export const MAX_DURATION_MS = 60_000

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

    await Database.use(async (db) => {
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

    return {
      id,
      size_bytes: audio_bytes.length,
    }
  }

  export async function get(input: { session_id: string; voice_id: string }) {
    return Database.use((db) =>
      db
        .select()
        .from(SessionVoiceTable)
        .where(and(eq(SessionVoiceTable.id, input.voice_id), eq(SessionVoiceTable.session_id, input.session_id)))
        .get(),
    )
  }
}
