import { index, integer, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpSavedPlanTable = table(
  "tp_saved_plan",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    message_id: text().notNull(),
    part_id: text().notNull(),
    project_id: text().notNull(),
    project_name: text(),
    project_worktree: text().notNull(),
    session_title: text().notNull(),
    user_id: text().notNull(),
    username: text().notNull(),
    display_name: text().notNull(),
    account_type: text().notNull(),
    org_id: text().notNull(),
    department_id: text(),
    agent: text().notNull(),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    message_created_at: integer().notNull(),
    plan_content: text().notNull(),
    vho_feedback_no: text(),
    ...Timestamps,
  },
  (table) => [
    index("tp_saved_plan_user_time_idx").on(table.user_id, table.time_created),
    index("tp_saved_plan_session_time_idx").on(table.session_id, table.time_created),
    index("tp_saved_plan_project_time_idx").on(table.project_id, table.time_created),
    index("tp_saved_plan_message_idx").on(table.message_id),
    index("tp_saved_plan_feedback_idx").on(table.vho_feedback_no),
  ],
)
