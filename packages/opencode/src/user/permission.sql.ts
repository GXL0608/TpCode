import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { TpRoleTable } from "./role.sql"

export const TpPermissionTable = sqliteTable("tp_permission", {
  id: text().primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
  group_name: text().notNull(),
  description: text(),
})

export const TpRolePermissionTable = sqliteTable(
  "tp_role_permission",
  {
    role_id: text()
      .notNull()
      .references(() => TpRoleTable.id, { onDelete: "cascade" }),
    permission_id: text()
      .notNull()
      .references(() => TpPermissionTable.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.role_id, table.permission_id] })],
)
