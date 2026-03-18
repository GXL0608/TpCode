import { Database, and, eq } from "@/storage/db"
import { RequestCurrent } from "@/server/request-current"
import { AccountCurrent } from "@/user/current"
import { UserService } from "@/user/service"
import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { generateText } from "ai"
import { MessageV2 } from "./message-v2"
import { SessionTable, TpSessionPictureTable } from "./session.sql"

const PREFIX = "picture"
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_OCR_TEXT_CHARS = 24_000
const UNKNOWN = "未识别"
const MAX_STRUCTURED_CHARS = 512
const DEFAULT_DATA_STATUS = "待标注"
const DEFAULT_ROLE = "一线人员"
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
  const message = messages(error).join("\n")
  return (
    message.includes("tp_session_picture") &&
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

async function ensureTable() {
  if (ensure) return ensure
  ensure = (async () => {
    await Database.raw(`
      create table if not exists "tp_session_picture" (
        "id" text primary key,
        "session_id" text not null references "session"("id") on delete cascade,
        "message_id" text not null references "message"("id") on delete cascade,
        "part_id" text not null,
        "user_id" text,
        "product_id" text,
        "role" text,
        "mime" text not null,
        "filename" text not null,
        "size_bytes" bigint not null,
        "ocr_text" text,
        "ocr_engine" text,
        "device_code" text,
        "error_code" text,
        "system_name" text,
        "problem_desc" text,
        "problem_type" text,
        "data_status" text,
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
    await Database.raw(`alter table "tp_session_picture" add column if not exists "user_id" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "product_id" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "role" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "device_code" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "error_code" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "system_name" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "problem_desc" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "problem_type" text`)
    await Database.raw(`alter table "tp_session_picture" add column if not exists "data_status" text`)
  })().catch((error) => {
    ensure = undefined
    throw error
  })
  return ensure
}

function normalize(value: string | undefined, fallback = UNKNOWN) {
  const next = value?.trim().replace(/\s+/g, " ").replace(/[，,;；。]+$/g, "")
  if (!next) return fallback
  return next.length > MAX_STRUCTURED_CHARS ? next.slice(0, MAX_STRUCTURED_CHARS) : next
}

function match(text: string, rules: RegExp[]) {
  for (const rule of rules) {
    const found = text.match(rule)
    if (!found?.[1]) continue
    return normalize(found[1], "")
  }
}

function toStructured(ocr_text?: string) {
  const text = ocr_text?.trim()
  if (!text) {
    return {
      device_code: UNKNOWN,
      error_code: UNKNOWN,
      system_name: UNKNOWN,
      problem_desc: UNKNOWN,
    }
  }
  return {
    device_code:
      match(text, [
        /(?:设备编号|设备编码|设备号|设备ID|设备id|设备)\s*[:：]\s*([A-Za-z0-9._-]{3,})/i,
        /(?:device(?:\s*code|\s*id|\s*no)?)\s*[:：]\s*([A-Za-z0-9._-]{3,})/i,
      ]) || UNKNOWN,
    error_code:
      match(text, [
        /(?:报错码|错误码|故障码|异常码|报错代码)\s*[:：]\s*([A-Za-z0-9._-]{2,})/i,
        /(?:error(?:\s*code)?|err(?:or)?\s*code)\s*[:：]\s*([A-Za-z0-9._-]{2,})/i,
      ]) || UNKNOWN,
    system_name:
      match(text, [
        /(?:系统名称|所属系统|系统)\s*[:：]\s*([^\n，,;；]{2,})/i,
        /(?:system(?:\s*name)?)\s*[:：]\s*([^\n,;]{2,})/i,
      ]) || UNKNOWN,
    problem_desc:
      match(text, [
        /(?:问题描述|故障描述|现象描述|问题现象|描述)\s*[:：]\s*([^\n]{2,})/i,
        /(?:problem(?:\s*desc(?:ription)?)?|issue|description)\s*[:：]\s*([^\n]{2,})/i,
      ]) || UNKNOWN,
  }
}

function desensitize(ocr_text?: string) {
  const text = ocr_text?.trim()
  if (!text) return text
  return text
    .replace(/(?<!\d)(1[3-9]\d{2})\d{4}(\d{4})(?!\d)/g, "$1****$2")
    .replace(/(?<![A-Za-z0-9])(\d{6})\d{8}(\d{3}[0-9Xx])(?![A-Za-z0-9])/g, "$1********$2")
    .replace(/(?:(住院号|病案号|患者编号|patient\s*id)\s*[:：]?\s*)([A-Za-z0-9_-]{6,})/gi, "$1: ****")
    .replace(/(?:(姓名|患者姓名|patient\s*name)\s*[:：]?\s*)([\u4e00-\u9fa5A-Za-z·\s]{2,20})/gi, "$1: **")
}

function classify(input: { error_code: string; device_code: string; ocr_text?: string }) {
  if (input.error_code !== UNKNOWN) return "软件报错"
  if (input.device_code !== UNKNOWN) return "设备故障"
  if (/(网络|wifi|网线|断网|丢包|延迟|network|timeout)/i.test(input.ocr_text ?? "")) return "网络问题"
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
    target_type: "tp_session_picture",
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

export namespace SessionPicture {
  export function extractStructuredFields(ocr_text?: string) {
    return toStructured(ocr_text)
  }

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
    const masked = desensitize(text)
    return {
      ocr_text: (masked ?? "").length > MAX_OCR_TEXT_CHARS ? (masked ?? "").slice(0, MAX_OCR_TEXT_CHARS) : masked,
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
    device_code?: string
    error_code?: string
    system_name?: string
    problem_desc?: string
    user_id?: string
    product_id?: string
    role?: string
    problem_type?: string
    data_status?: string
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
    const safe_ocr_text = desensitize(input.ocr_text)
    const parsed = extractStructuredFields(safe_ocr_text)
    const device_code = normalize(input.device_code, "") || parsed.device_code
    const error_code = normalize(input.error_code, "") || parsed.error_code
    const system_name = normalize(input.system_name, "") || parsed.system_name
    const problem_desc = normalize(input.problem_desc, "") || parsed.problem_desc
    const problem_type = input.problem_type?.trim() || classify({ error_code, device_code, ocr_text: safe_ocr_text })
    const data_status = input.data_status?.trim() || DEFAULT_DATA_STATUS
    const role = input.role?.trim() || DEFAULT_ROLE

    const write = () =>
      Database.use(async (db) => {
        const existing = await db
          .select({ id: TpSessionPictureTable.id })
          .from(TpSessionPictureTable)
          .where(eq(TpSessionPictureTable.part_id, input.part_id))
          .get()
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
        await db.insert(TpSessionPictureTable)
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
            size_bytes: image_bytes.length,
            ocr_text: safe_ocr_text,
            ocr_engine: input.ocr_engine,
            device_code,
            error_code,
            system_name,
            problem_desc,
            problem_type,
            data_status,
            image_bytes,
            time_created: now,
            time_updated: now,
          })
          .onConflictDoUpdate({
            target: TpSessionPictureTable.part_id,
            set: {
              session_id: input.session_id,
              message_id: input.message_id,
              user_id,
              product_id,
              role,
              mime: input.mime,
              filename: input.filename,
              size_bytes: image_bytes.length,
              ocr_text: safe_ocr_text,
              ocr_engine: input.ocr_engine,
              device_code,
              error_code,
              system_name,
              problem_desc,
              problem_type,
              data_status,
              image_bytes,
              time_updated: now,
            },
          })
          .run()

        audit({
          action: existing ? "session.picture.update" : "session.picture.create",
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
            device_code,
            error_code,
            system_name,
            problem_desc,
            problem_type,
            data_status,
          },
        })
      })

    try {
      await write()
    } catch (error) {
      if (!isSchemaError(error)) throw error
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
          id: TpSessionPictureTable.id,
          user_id: TpSessionPictureTable.user_id,
          product_id: TpSessionPictureTable.product_id,
          role: TpSessionPictureTable.role,
          device_code: TpSessionPictureTable.device_code,
          error_code: TpSessionPictureTable.error_code,
          system_name: TpSessionPictureTable.system_name,
          problem_desc: TpSessionPictureTable.problem_desc,
          problem_type: TpSessionPictureTable.problem_type,
          data_status: TpSessionPictureTable.data_status,
        })
        .from(TpSessionPictureTable)
        .where(
          and(
            eq(TpSessionPictureTable.session_id, input.session_id),
            eq(TpSessionPictureTable.message_id, input.message_id),
            eq(TpSessionPictureTable.part_id, input.part_id),
          ),
        )
        .get(),
    )
    if (!row) return

    const write = () =>
      Database.use((db) =>
        db
          .delete(TpSessionPictureTable)
          .where(
            and(
              eq(TpSessionPictureTable.session_id, input.session_id),
              eq(TpSessionPictureTable.message_id, input.message_id),
              eq(TpSessionPictureTable.part_id, input.part_id),
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
      action: "session.picture.delete",
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
        device_code: row.device_code,
        error_code: row.error_code,
        system_name: row.system_name,
        problem_desc: row.problem_desc,
        problem_type: row.problem_type,
        data_status: row.data_status,
      },
    })
  }
}
