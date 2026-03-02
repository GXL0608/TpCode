import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { TpUserTable } from "./user.sql"

export const TpPasswordResetTable = sqliteTable(
  "tp_password_reset",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    code_hash: text().notNull(),
    channel: text().notNull(),
    expires_at: integer().notNull(),
    consumed_at: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("tp_password_reset_user_idx").on(table.user_id), index("tp_password_reset_expires_idx").on(table.expires_at)],
)
