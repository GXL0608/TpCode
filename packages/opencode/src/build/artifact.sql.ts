import { index, integer, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpBuildJobTable } from "./job.sql"
import { TpProductSolutionTable } from "@/user/product-solution.sql"

export const TpBuildArtifactTable = table(
  "tp_build_artifact",
  {
    id: text().primaryKey(),
    job_id: text()
      .notNull()
      .references(() => TpBuildJobTable.id, { onDelete: "cascade" }),
    solution_id: text()
      .notNull()
      .references(() => TpProductSolutionTable.id, { onDelete: "cascade" }),
    file_name: text().notNull(),
    file_path: text().notNull(),
    size: integer().notNull().$default(() => 0),
    hash: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("tp_build_artifact_job_idx").on(table.job_id),
    index("tp_build_artifact_solution_idx").on(table.solution_id),
  ],
)
