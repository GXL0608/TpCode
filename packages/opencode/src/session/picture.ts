import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { generateText } from "ai"
import { MessageV2 } from "./message-v2"
import { TpSessionPictureTable } from "./session.sql"

const PREFIX = "picture"
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_OCR_TEXT_CHARS = 24_000
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
  export async function extractDataUrlOCR(input: {
    mime: string
    data_url: string
    model: {
      providerID: string
      modelID: string
    }
  }) {
    if (!input.mime.startsWith("image/")) return
    const picked = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
    if (!picked) return

    const language = await Provider.getLanguage(picked).catch(() => undefined)
    if (!language) return

    const user: MessageV2.User = {
      id: "message_ocr",
      sessionID: "session_ocr",
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "build",
      model: input.model,
    }
    const messages = MessageV2.toModelMessages(
      [
        {
          info: user,
          parts: [
            {
              id: "part_ocr_text",
              sessionID: user.sessionID,
              messageID: user.id,
              type: "text",
              text: "Extract all readable text from this image. Return plain text only. If no text is present, return an empty string.",
            },
            {
              id: "part_ocr_file",
              sessionID: user.sessionID,
              messageID: user.id,
              type: "file",
              mime: input.mime,
              filename: "attachment",
              url: input.data_url,
            },
          ],
        },
      ],
      picked,
    )

    const result = await generateText({
      model: language,
      temperature: 0,
      maxOutputTokens: 1200,
      messages,
      abortSignal: AbortSignal.timeout(Number(process.env.OPENCODE_IMAGE_OCR_TIMEOUT_MS ?? "12000")),
    }).catch((error) => {
      log.warn("image OCR generation failed", {
        error,
        providerID: picked.providerID,
        modelID: picked.id,
      })
      return undefined
    })
    if (!result) return

    const text = result.text.trim()
    if (!text) return
    return {
      ocr_text: text.length > MAX_OCR_TEXT_CHARS ? text.slice(0, MAX_OCR_TEXT_CHARS) : text,
      ocr_engine: `llm_vision:${picked.providerID}/${picked.id}`,
    }
  }

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
