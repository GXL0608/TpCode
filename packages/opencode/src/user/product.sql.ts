import { index, integer, table, text, uniqueIndex } from "../storage/orm-core"
import { ProjectTable } from "@/project/project.sql"
import { Timestamps } from "@/storage/schema.sql"
import { isNull } from "drizzle-orm"

export const TpProductTable = table(
  "tp_product",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
    // 中文注释：逻辑删除时间；为空表示仍然有效。
    time_deleted: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_product_name_unique").on(table.name).where(isNull(table.time_deleted)),
    uniqueIndex("tp_product_project_uidx").on(table.project_id).where(isNull(table.time_deleted)),
    index("tp_product_project_idx").on(table.project_id),
    index("tp_product_deleted_idx").on(table.time_deleted),
  ],
)
