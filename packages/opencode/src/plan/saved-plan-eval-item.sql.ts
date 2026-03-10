import { index, integer, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpSavedPlanEvalTable } from "./saved-plan-eval.sql"
import { TpSavedPlanTable } from "./saved-plan.sql"

export const TpSavedPlanEvalItemTable = table(
  "tp_saved_plan_eval_item",
  {
    id: text().primaryKey(),
    eval_id: text()
      .notNull()
      .references(() => TpSavedPlanEvalTable.id, { onDelete: "cascade" }),
    plan_id: text()
      .notNull()
      .references(() => TpSavedPlanTable.id, { onDelete: "cascade" }),
    vho_feedback_no: text(),
    subject: text().notNull(),
    dimension_code: text().notNull(),
    dimension_name: text().notNull(),
    max_deduction: integer().notNull(),
    deducted_score: integer().notNull(),
    final_score: integer().notNull(),
    reason: text().notNull(),
    evidence_json: text({ mode: "json" }).$type<string[]>().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("tp_saved_plan_eval_item_eval_position_idx").on(table.eval_id, table.position),
    index("tp_saved_plan_eval_item_plan_idx").on(table.plan_id),
    index("tp_saved_plan_eval_item_feedback_idx").on(table.vho_feedback_no),
    index("tp_saved_plan_eval_item_subject_dimension_idx").on(table.subject, table.dimension_code),
  ],
)
