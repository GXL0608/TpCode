import { uniqueIndex, index, integer, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpSavedPlanTable } from "./saved-plan.sql"

export const TpSavedPlanEvalTable = table(
  "tp_saved_plan_eval",
  {
    id: text().primaryKey(),
    plan_id: text()
      .notNull()
      .references(() => TpSavedPlanTable.id, { onDelete: "cascade" }),
    vho_feedback_no: text(),
    user_id: text().notNull(),
    session_id: text().notNull(),
    user_message_id: text().notNull(),
    assistant_message_id: text().notNull(),
    part_id: text().notNull(),
    status: text().notNull(),
    rubric_version: text(),
    prompt_version: text(),
    judge_provider_id: text(),
    judge_model_id: text(),
    user_score: integer(),
    assistant_score: integer(),
    summary: text(),
    major_issue_side: text(),
    result_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    error_code: text(),
    error_message: text(),
    time_started: integer(),
    time_finished: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_saved_plan_eval_plan_uidx").on(table.plan_id),
    index("tp_saved_plan_eval_feedback_idx").on(table.vho_feedback_no),
    index("tp_saved_plan_eval_user_time_idx").on(table.user_id, table.time_created),
    index("tp_saved_plan_eval_session_time_idx").on(table.session_id, table.time_created),
    index("tp_saved_plan_eval_status_time_idx").on(table.status, table.time_created),
  ],
)
