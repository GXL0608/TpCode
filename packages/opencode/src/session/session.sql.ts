import { table, text, integer, index, primaryKey } from "../storage/orm-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"
import { TpDepartmentTable } from "@/user/department.sql"
import { TpOrganizationTable } from "@/user/organization.sql"
import { TpUserTable } from "@/user/user.sql"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = table(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
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
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_user_idx").on(table.user_id),
    index("session_org_idx").on(table.org_id),
    index("session_department_idx").on(table.department_id),
    index("session_visibility_idx").on(table.visibility),
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
  (table) => [index("message_session_idx").on(table.session_id)],
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
