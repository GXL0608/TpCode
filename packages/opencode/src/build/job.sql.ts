import { boolean_int, index, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { SessionTable } from "@/session/session.sql"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { TpProductTable } from "@/user/product.sql"
import { TpProductSolutionTable } from "@/user/product-solution.sql"

export const TpBuildJobTable = table(
  "tp_build_job",
  {
    id: text().primaryKey(),
    source_type: text().notNull(),
    source_id: text(),
    prompt_text: text(),
    product_id: text()
      .notNull()
      .references(() => TpProductTable.id, { onDelete: "cascade" }),
    solution_scope: text().notNull().$default(() => "single"),
    solution_id: text()
      .notNull()
      .references(() => TpProductSolutionTable.id, { onDelete: "cascade" }),
    runtime_provider_id: text(),
    runtime_model_id: text(),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    workspace_id: text().references(() => WorkspaceTable.id, { onDelete: "set null" }),
    status: text().notNull(),
    current_stage: text(),
    plan_content: text(),
    started: boolean_int().notNull().$default(() => false),
    error_code: text(),
    error_message: text(),
    ...Timestamps,
  },
  (table) => [
    index("tp_build_job_product_time_idx").on(table.product_id, table.time_created),
    index("tp_build_job_scope_time_idx").on(table.solution_scope, table.time_created),
    index("tp_build_job_solution_time_idx").on(table.solution_id, table.time_created),
    index("tp_build_job_status_time_idx").on(table.status, table.time_created),
  ],
)
