import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import { TpSessionPictureTable } from "./session.sql"

const PREFIX = "picture"
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const log = Log.create({ service: "session.picture" })

let ensure: Promise<void> | undefined

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",")
  if (comma < 0) throw new Error("Invalid image data URL")

  const header = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (!payload) throw new Error("Image payload is empty")

  const bytes = header.includes(";base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf-8")

  if (bytes.length === 0) throw new Error("Image payload is empty")
  return bytes
}

function isMissingTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("tp_session_picture") &&
    (message.includes("does not exist") || message.includes("undefined_table") || message.includes("no such table"))
  )
}

async function ensureTable() {
  if (ensure) return ensure
  ensure = (async () => {
    await Database.raw(`
      create table if not exists "tp_session_picture" (
        "id" text primary key,
        "session_id" text not null references "session"("id") on delete cascade,
        "message_id" text not null references "message"("id") on delete cascade,
        "part_id" text not null,
        "mime" text not null,
        "filename" text not null,
        "size_bytes" bigint not null,
        "ocr_text" text,
        "ocr_engine" text,
        "image_bytes" bytea not null,
        "time_created" bigint not null,
        "time_updated" bigint not null,
        constraint "tp_session_picture_size_check" check ("size_bytes" >= 0 and "size_bytes" <= 20971520)
      )
    `)
    await Database.raw(
      `create index if not exists "tp_session_picture_session_time_idx" on "tp_session_picture" ("session_id", "time_created")`,
    )
    await Database.raw(
      `create index if not exists "tp_session_picture_message_idx" on "tp_session_picture" ("message_id")`,
    )
    await Database.raw(
      `create unique index if not exists "tp_session_picture_part_uidx" on "tp_session_picture" ("part_id")`,
    )
  })().catch((error) => {
    ensure = undefined
    throw error
  })
  return ensure
}

export namespace SessionPicture {
  export async function saveDataFile(input: {
    id?: string
    session_id: string
    message_id: string
    part_id: string
    mime: string
    filename: string
    ocr_text?: string
    ocr_engine?: string
    data_url: string
  }) {
    if (!input.mime.startsWith("image/")) {
      throw new Error(`Unsupported image mime type: ${input.mime}`)
    }

    const image_bytes = decodeDataUrl(input.data_url)
    if (image_bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image size exceeds max ${MAX_IMAGE_BYTES} bytes`)
    }

    const id = input.id ?? `${PREFIX}_${input.part_id}`
    const now = Date.now()

    const write = () =>
      Database.use(async (db) => {
        await db.insert(TpSessionPictureTable)
          .values({
            id,
            session_id: input.session_id,
            message_id: input.message_id,
            part_id: input.part_id,
            mime: input.mime,
            filename: input.filename,
            size_bytes: image_bytes.length,
            ocr_text: input.ocr_text,
            ocr_engine: input.ocr_engine,
            image_bytes,
            time_created: now,
            time_updated: now,
          })
          .onConflictDoUpdate({
            target: TpSessionPictureTable.part_id,
            set: {
              session_id: input.session_id,
              message_id: input.message_id,
              mime: input.mime,
              filename: input.filename,
              size_bytes: image_bytes.length,
              ocr_text: input.ocr_text,
              ocr_engine: input.ocr_engine,
              image_bytes,
              time_updated: now,
            },
          })
          .run()
      })

    try {
      await write()
    } catch (error) {
      if (!isMissingTableError(error)) throw error
      log.warn("tp_session_picture table missing, creating fallback table", {
        error,
        session_id: input.session_id,
      })
      await ensureTable()
      await write()
    }

    return {
      id,
      size_bytes: image_bytes.length,
    }
  }
}
