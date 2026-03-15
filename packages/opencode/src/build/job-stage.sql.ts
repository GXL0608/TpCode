import { index, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpBuildJobTable } from "./job.sql"

export const TpBuildJobStageTable = table(
  "tp_build_job_stage",
  {
    id: text().primaryKey(),
    job_id: text()
      .notNull()
      .references(() => TpBuildJobTable.id, { onDelete: "cascade" }),
    stage: text().notNull(),
    status: text().notNull(),
    detail_json: text({ mode: "json" }),
    error_code: text(),
    error_message: text(),
    ...Timestamps,
  },
  (table) => [
    index("tp_build_job_stage_job_idx").on(table.job_id),
    index("tp_build_job_stage_job_stage_idx").on(table.job_id, table.stage),
  ],
)
