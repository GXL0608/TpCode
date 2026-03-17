import { boolean_int, table, text, uniqueIndex } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpProductSolutionTable = table(
  "tp_product_solution",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    code: text().notNull(),
    enabled: boolean_int().notNull().$default(() => true),
    build_profile_json: text({ mode: "json" }).notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("tp_product_solution_code_uidx").on(table.code)],
)
