import { boolean_int, integer, table, text, uniqueIndex, index } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { isNull } from "drizzle-orm"

export const TpProductSolutionTable = table(
  "tp_product_solution",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    code: text().notNull(),
    enabled: boolean_int().notNull().$default(() => true),
    build_profile_json: text({ mode: "json" }).notNull(),
    // 中文注释：逻辑删除时间；为空表示仍然有效。
    time_deleted: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_product_solution_code_uidx").on(table.code).where(isNull(table.time_deleted)),
    index("tp_product_solution_deleted_idx").on(table.time_deleted),
  ],
)
