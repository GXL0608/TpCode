import { boolean_int, index, table, text, uniqueIndex } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpProductTable } from "./product.sql"
import { ProjectTable } from "@/project/project.sql"

export const TpProductSolutionTable = table(
  "tp_product_solution",
  {
    id: text().primaryKey(),
    product_id: text()
      .notNull()
      .references(() => TpProductTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    enabled: boolean_int().notNull().$default(() => true),
    primary_project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
    build_profile_json: text({ mode: "json" }).notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_product_solution_product_code_uidx").on(table.product_id, table.code),
    index("tp_product_solution_product_idx").on(table.product_id),
  ],
)
