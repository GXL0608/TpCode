import { ProjectTable } from "@/project/project.sql"
import { index, integer, table, text } from "@/storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpFeedbackThreadTable = table(
  "tp_feedback_thread",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    product_id: text().notNull(),
    product_name: text().notNull(),
    page_name: text().notNull(),
    menu_path: text(),
    source_platform: text().notNull(),
    user_id: text().notNull(),
    username: text().notNull(),
    display_name: text().notNull(),
    org_id: text().notNull(),
    department_id: text(),
    title: text().notNull(),
    content: text().notNull(),
    status: text()
      .notNull()
      .$default(() => "open"),
    resolved_by: text(),
    resolved_name: text(),
    resolved_at: integer(),
    last_reply_at: integer().notNull(),
    reply_count: integer()
      .notNull()
      .$default(() => 0),
    ...Timestamps,
  },
  (table) => [
    index("tp_feedback_thread_project_idx").on(table.project_id),
    index("tp_feedback_thread_product_idx").on(table.product_id),
    index("tp_feedback_thread_status_idx").on(table.status),
    index("tp_feedback_thread_user_idx").on(table.user_id),
    index("tp_feedback_thread_last_reply_idx").on(table.last_reply_at),
  ],
)
