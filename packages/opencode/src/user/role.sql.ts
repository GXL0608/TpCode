import { index, integer, primaryKey, table, text, uniqueIndex } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { Timestamps } from "@/storage/schema.sql"
import { isNull } from "drizzle-orm"

export const TpRoleTable = table(
  "tp_role",
  {
    id: text().primaryKey(),
    code: text().notNull(),
    name: text().notNull(),
    scope: text().notNull(),
    description: text(),
    status: text()
      .notNull()
      .$default(() => "active"),
    // 中文注释：逻辑删除时间；为空表示仍然有效。
    time_deleted: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_role_code_unique").on(table.code).where(isNull(table.time_deleted)),
    index("tp_role_deleted_idx").on(table.time_deleted),
  ],
)

export const TpUserRoleTable = table(
  "tp_user_role",
  {
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    role_id: text()
      .notNull()
      .references(() => TpRoleTable.id, { onDelete: "cascade" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.role_id] })],
)
