import { index, table, text, uniqueIndex } from "../storage/orm-core"
import { ProjectTable } from "@/project/project.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpProductTable = table(
  "tp_product",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_product_name_unique").on(table.name),
    uniqueIndex("tp_product_project_uidx").on(table.project_id),
    index("tp_product_project_idx").on(table.project_id),
  ],
)
