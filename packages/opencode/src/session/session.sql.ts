import { table, text, integer, bytes, index, primaryKey, uniqueIndex } from "../storage/orm-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"
import { TpDepartmentTable } from "@/user/department.sql"
import { TpOrganizationTable } from "@/user/organization.sql"
import { TpUserTable } from "@/user/user.sql"
import { isNull } from "drizzle-orm"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import type { WorkspaceKind } from "@/control-plane/workspace-meta"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = table(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    context_project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
    parent_id: text(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: string; partID?: string; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    user_id: text().references(() => TpUserTable.id, { onDelete: "set null" }),
    org_id: text().references(() => TpOrganizationTable.id, { onDelete: "set null" }),
    department_id: text().references(() => TpDepartmentTable.id, { onDelete: "set null" }),
    visibility: text()
      .notNull()
      .$default(() => "private"),
    runtime_provider_id: text(),
    runtime_model_id: text(),
    runtime_model_source: text(),
    // 中文注释：当前 session 绑定的工作区记录标识，批量沙盒依赖该字段追踪生命周期。
    workspace_id: text().references(() => WorkspaceTable.id, { onDelete: "set null" }),
    workspace_directory: text(),
    workspace_branch: text(),
    // 中文注释：当前 session 绑定工作区的类型，供前后端快速分流单仓与批量逻辑。
    workspace_kind: text().$type<WorkspaceKind>(),
    workspace_status: text(),
    workspace_cleanup_status: text(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_context_project_idx").on(table.context_project_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_user_idx").on(table.user_id),
    index("session_org_idx").on(table.org_id),
    index("session_department_idx").on(table.department_id),
    index("session_visibility_idx").on(table.visibility),
    index("session_project_user_time_idx").on(table.project_id, table.user_id, table.time_updated, table.id),
    index("session_project_parent_time_idx").on(table.project_id, table.parent_id, table.time_updated, table.id),
    index("session_project_time_idx").on(table.project_id, table.time_updated, table.id),
    index("session_time_id_idx").on(table.time_updated, table.id),
    index("session_user_time_active_idx")
      .on(table.user_id, table.time_updated, table.id)
      .where(isNull(table.time_archived)),
  ],
)

export const MessageTable = table(
  "message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [
    index("message_session_idx").on(table.session_id),
    index("message_session_time_idx").on(table.session_id, table.time_created, table.id),
  ],
)

export const PartTable = table(
  "part",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
)

export const SessionVoiceTable = table(
  "session_voice",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    part_id: text().notNull(),
    mime: text().notNull(),
    filename: text().notNull(),
    duration_ms: integer(),
    size_bytes: integer().notNull(),
    stt_text: text(),
    stt_engine: text(),
    audio_bytes: bytes().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("session_voice_session_time_idx").on(table.session_id, table.time_created),
    index("session_voice_message_idx").on(table.message_id),
    uniqueIndex("session_voice_part_uidx").on(table.part_id),
  ],
)

export const TpSessionPictureTable = table(
  "tp_session_picture",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    part_id: text().notNull(),
    mime: text().notNull(),
    filename: text().notNull(),
    size_bytes: integer().notNull(),
    ocr_text: text(),
    ocr_engine: text(),
    image_bytes: bytes().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("tp_session_picture_session_time_idx").on(table.session_id, table.time_created),
    index("tp_session_picture_message_idx").on(table.message_id),
    uniqueIndex("tp_session_picture_part_uidx").on(table.part_id),
  ],
)

export const TpSessionModelCallRecordTable = table(
  "tp_session_model_call_record",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    teacher_user_message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    teacher_assistant_message_id: text().references(() => MessageTable.id, { onDelete: "set null" }),
    teacher_provider_id: text().notNull(),
    teacher_model_id: text().notNull(),
    teacher_agent: text().notNull(),
    request_protocol: text(),
    request_text: text(),
    response_text: text(),
    reasoning_text: text(),
    usage_text: text(),
    meta_text: text(),
    student_provider_id: text(),
    student_model_id: text(),
    student_request_protocol: text(),
    student_status: text(),
    student_error_code: text(),
    student_error_message: text(),
    student_response_text: text(),
    student_reasoning_text: text(),
    student_usage_text: text(),
    status: text().notNull(),
    error_code: text(),
    error_message: text(),
    finished_at: integer(),
    student_finished_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("tp_session_model_call_record_session_time_idx").on(table.session_id, table.time_created),
    index("tp_session_model_call_record_user_message_idx").on(table.teacher_user_message_id),
    index("tp_session_model_call_record_assistant_message_idx").on(table.teacher_assistant_message_id),
    index("tp_session_model_call_record_status_time_idx").on(table.status, table.time_created),
  ],
)

export const TodoTable = table(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = table("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})

export const SyncQueueTable = table(
  "sync_queue",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    event_type: text().notNull(),
    payload: text({ mode: "json" }).notNull().$type<any>(),
    attempts: integer().default(0).notNull(),
    last_error: text(),
    next_retry: integer(),
    ...Timestamps,
  },
  (table) => [
    index("sync_queue_session_idx").on(table.session_id),
    index("sync_queue_retry_idx").on(table.next_retry),
  ],
)

export const SyncStateTable = table(
  "sync_state",
  {
    scope: text().primaryKey(),
    full_sync_completed_at: integer(),
    ...Timestamps,
  },
  (table) => [index("sync_state_full_sync_idx").on(table.full_sync_completed_at)],
)
