import { boolean_int, index, integer, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpProductSolutionTable } from "./product-solution.sql"

export const TpProductSolutionRootTable = table(
  "tp_product_solution_root",
  {
    id: text().primaryKey(),
    solution_id: text()
      .notNull()
      .references(() => TpProductSolutionTable.id, { onDelete: "cascade" }),
    root_type: text().notNull(),
    directory: text().notNull(),
    display_name: text(),
    sort_order: integer().notNull().$default(() => 0),
    enabled: boolean_int().notNull().$default(() => true),
    meta_json: text({ mode: "json" }),
    ...Timestamps,
  },
  (table) => [
    index("tp_product_solution_root_solution_idx").on(table.solution_id),
    index("tp_product_solution_root_solution_sort_idx").on(table.solution_id, table.sort_order),
  ],
)
