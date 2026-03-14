import { ulid } from "ulid"
import { Database, eq } from "@/storage/db"
import { Context } from "@/util/context"
import { Log } from "@/util/log"
import { MessageV2 } from "./message-v2"
import { TpSessionModelCallRecordTable } from "./session.sql"

type Role = "teacher" | "student"

type Operation =
  | "begin"
  | "bind_teacher_assistant"
  | "capture_teacher_request"
  | "finish_teacher"
  | "bind_student"
  | "capture_student_request"
  | "finish_student"

type Hook = (input: { recordID: string; operation: Operation }) => void | Promise<void>

const log = Log.create({ service: "session.model-call" })

const current = Context.create<{
  recordID: string
  role: Role
}>("session-model-call")

const queue = new Map<string, Promise<void>>()
const byUser = new Map<string, string>()
const byRecord = new Map<string, string>()

let hook: Hook | undefined

/** 中文注释：读取当前调用记录上下文；无上下文时静默返回，避免影响主业务链路。 */
function optional() {
  try {
    return current.use()
  } catch (error) {
    if (error instanceof Context.NotFound) return
    throw error
  }
}

/** 中文注释：统一把对象安全序列化为文本，供数据库 text 字段存储。 */
function stringify(input: unknown) {
  if (input === undefined) return null
  if (input === null) return null
  return typeof input === "string" ? input : JSON.stringify(input)
}

/** 中文注释：把各种错误对象收敛成数据库可落的错误码和错误消息。 */
function failure(error: unknown) {
  if (error instanceof Error) {
    return {
      code: error.name,
      message: error.message,
    }
  }
  if (typeof error === "object" && error && "name" in error && "message" in error) {
    return {
      code: String(error.name),
      message: String(error.message),
    }
  }
  return {
    code: "ModelCallError",
    message: String(error),
  }
}

/** 中文注释：生成最小非敏感元数据文本，明确当前采集来源和角色。 */
function meta(role: Role) {
  return JSON.stringify({
    version: 1,
    capture: "provider.fetch",
    role,
  })
}

/** 中文注释：判断本轮教师执行是否已经终态，用于清理内存映射。 */
function terminal(input: { finish?: string; error?: unknown }) {
  if (input.error) return true
  return !!input.finish && input.finish !== "tool-calls"
}

/** 中文注释：清理用户消息到记录的临时内存映射，避免随着会话累积而泄漏。 */
function clear(recordID: string) {
  const userMessageID = byRecord.get(recordID)
  if (userMessageID) byUser.delete(userMessageID)
  byRecord.delete(recordID)
}

/** 中文注释：把同一 record 的写入串行为后台任务，保证顺序且绝不阻塞主业务。 */
function push(recordID: string, operation: Operation, job: () => Promise<void>) {
  const prev = queue.get(recordID) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await hook?.({ recordID, operation })
      await job()
    })
    .catch((error) => {
      log.warn("model call write failed", {
        recordID,
        operation,
        error,
      })
    })
    .finally(() => {
      if (queue.get(recordID) === next) queue.delete(recordID)
    })
  queue.set(recordID, next)
}

/** 中文注释：汇总 assistant message 的文本与思考内容，供教师完成态异步落库。 */
async function output(messageID: string) {
  const parts = await MessageV2.parts(messageID)
  return {
    responseText: parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    reasoningText: parts
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text)
      .join(""),
  }
}

export namespace SessionModelCall {
  /** 中文注释：为一次教师回合预创建统一调用记录草稿，并立即返回 recordID。 */
  export function createTeacherDraft(input: {
    sessionID: string
    userMessageID: string
    teacherProviderID: string
    teacherModelID: string
    teacherAgent: string
  }) {
    const id = ulid()
    byUser.set(input.userMessageID, id)
    byRecord.set(id, input.userMessageID)
    push(id, "begin", async () => {
      await Database.use((db) =>
        db
          .insert(TpSessionModelCallRecordTable)
          .values({
            id,
            session_id: input.sessionID,
            teacher_user_message_id: input.userMessageID,
            teacher_provider_id: input.teacherProviderID,
            teacher_model_id: input.teacherModelID,
            teacher_agent: input.teacherAgent,
            status: "pending",
          })
          .run(),
      )
    })
    return { id }
  }

  /** 中文注释：按教师用户消息读取当前轮 recordID，避免在主链路上查询数据库。 */
  export function getByUserMessageID(userMessageID: string) {
    const id = byUser.get(userMessageID)
    if (!id) return
    return { id }
  }

  /** 中文注释：绑定当前轮最新的教师 assistant message，保证最终结果可直接关联查询。 */
  export function setTeacherAssistant(input: {
    recordID: string
    assistantMessageID: string
  }) {
    push(input.recordID, "bind_teacher_assistant", async () => {
      await Database.use((db) =>
        db
          .update(TpSessionModelCallRecordTable)
          .set({
            teacher_assistant_message_id: input.assistantMessageID,
            status: "running",
          })
          .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
          .run(),
      )
    })
  }

  /** 中文注释：为学生模型补充当前行的模型身份与初始状态。 */
  export function bindStudent(input: {
    recordID: string
    providerID: string
    modelID: string
  }) {
    push(input.recordID, "bind_student", async () => {
      await Database.use((db) =>
        db
          .update(TpSessionModelCallRecordTable)
          .set({
            student_provider_id: input.providerID,
            student_model_id: input.modelID,
            student_status: "pending",
          })
          .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
          .run(),
      )
    })
  }

  /** 中文注释：在统一上下文中执行模型调用，使底层 provider fetch 能拿到当前记录身份。 */
  export function provideCapture<T>(input: { recordID: string; role: Role }, fn: () => Promise<T>) {
    return current.provide(
      {
        recordID: input.recordID,
        role: input.role,
      },
      fn,
    )
  }

  /** 中文注释：由 provider 底层 fetch 在真正发起上游请求前回填协议与最终请求体。 */
  export function captureRequest(input: {
    protocol: string
    requestText?: string
  }) {
    const value = optional()
    if (!value) return
    if (value.role === "teacher") {
      push(value.recordID, "capture_teacher_request", async () => {
        await Database.use((db) =>
          db
            .update(TpSessionModelCallRecordTable)
            .set({
              request_protocol: input.protocol,
              request_text: input.requestText ?? null,
              status: "running",
              meta_text: meta("teacher"),
            })
            .where(eq(TpSessionModelCallRecordTable.id, value.recordID))
            .run(),
        )
      })
      return
    }
    push(value.recordID, "capture_student_request", async () => {
      await Database.use((db) =>
        db
          .update(TpSessionModelCallRecordTable)
          .set({
            student_request_protocol: input.protocol,
            student_status: "running",
            meta_text: meta("student"),
          })
          .where(eq(TpSessionModelCallRecordTable.id, value.recordID))
          .run(),
      )
    })
  }

  /** 中文注释：在教师当前步完成后，异步汇总并回写最终回复、思考、用量和状态。 */
  export function completeTeacher(input: {
    recordID: string
    messageID: string
    usage: unknown
    finish?: string
    error?: unknown
  }) {
    push(input.recordID, "finish_teacher", async () => {
      const done = Date.now()
      const text = await output(input.messageID)
      if (input.error) {
        const detail = failure(input.error)
        await Database.use((db) =>
          db
            .update(TpSessionModelCallRecordTable)
            .set({
              status: "failed",
              error_code: detail.code,
              error_message: detail.message,
              response_text: text.responseText || null,
              reasoning_text: text.reasoningText || null,
              usage_text: stringify(input.usage),
              finished_at: done,
            })
            .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
            .run(),
        )
        return
      }
      await Database.use((db) =>
        db
          .update(TpSessionModelCallRecordTable)
          .set({
            status: "succeeded",
            error_code: null,
            error_message: null,
            response_text: text.responseText || null,
            reasoning_text: text.reasoningText || null,
            usage_text: stringify(input.usage),
            finished_at: done,
          })
          .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
          .run(),
      )
    })
    if (terminal(input)) clear(input.recordID)
  }

  /** 中文注释：在学生镜像调用完成后，把结果补写回与教师一一对应的同一行。 */
  export function completeStudent(input: {
    recordID: string
    responseText: string
    reasoningText: string
    usage: unknown
    error?: unknown
  }) {
    push(input.recordID, "finish_student", async () => {
      const done = Date.now()
      if (input.error) {
        const detail = failure(input.error)
        await Database.use((db) =>
          db
            .update(TpSessionModelCallRecordTable)
            .set({
              student_status: "failed",
              student_error_code: detail.code,
              student_error_message: detail.message,
              student_response_text: input.responseText || null,
              student_reasoning_text: input.reasoningText || null,
              student_usage_text: stringify(input.usage),
              student_finished_at: done,
            })
            .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
            .run(),
        )
        return
      }
      await Database.use((db) =>
        db
          .update(TpSessionModelCallRecordTable)
          .set({
            student_status: "succeeded",
            student_error_code: null,
            student_error_message: null,
            student_response_text: input.responseText || null,
            student_reasoning_text: input.reasoningText || null,
            student_usage_text: stringify(input.usage),
            student_finished_at: done,
          })
          .where(eq(TpSessionModelCallRecordTable.id, input.recordID))
          .run(),
      )
    })
  }

  /** 中文注释：等待当前所有后台写入任务结束，专供测试验证使用。 */
  export async function waitForIdle() {
    while (queue.size) {
      await Promise.allSettled([...new Set(queue.values())])
    }
  }

  /** 中文注释：注册测试钩子，用于模拟慢写入、异常和顺序观测。 */
  export function setTestHook(input?: Hook) {
    hook = input
  }

  /** 中文注释：重置测试态上下文，避免不同测试之间相互污染。 */
  export async function resetForTest() {
    await waitForIdle()
    hook = undefined
    byUser.clear()
    byRecord.clear()
  }
}
