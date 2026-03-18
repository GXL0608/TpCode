import { boolean_int, index, integer, table, text, uniqueIndex } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpProductTable } from "./product.sql"
import { TpProductSolutionTable } from "./product-solution.sql"
import { isNull } from "drizzle-orm"

export const TpProductSolutionBindingTable = table(
  "tp_product_solution_binding",
  {
    id: text().primaryKey(),
    product_id: text()
      .notNull()
      .references(() => TpProductTable.id, { onDelete: "cascade" }),
    solution_id: text()
      .notNull()
      .references(() => TpProductSolutionTable.id, { onDelete: "cascade" }),
    enabled: boolean_int().notNull().$default(() => true),
    sort_order: integer().notNull().$default(() => 0),
    // 中文注释：逻辑删除时间；为空表示仍然有效。
    time_deleted: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_product_solution_binding_product_solution_uidx")
      .on(table.product_id, table.solution_id)
      .where(isNull(table.time_deleted)),
    index("tp_product_solution_binding_product_idx").on(table.product_id),
    index("tp_product_solution_binding_solution_idx").on(table.solution_id),
    index("tp_product_solution_binding_product_sort_idx").on(table.product_id, table.sort_order),
    index("tp_product_solution_binding_deleted_idx").on(table.time_deleted),
  ],
)
