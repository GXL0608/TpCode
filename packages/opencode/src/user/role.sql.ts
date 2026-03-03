import { integer, primaryKey, table, text } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpRoleTable = table("tp_role", {
  id: text().primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
  scope: text().notNull(),
  description: text(),
  status: text()
    .notNull()
    .$default(() => "active"),
  ...Timestamps,
})

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
