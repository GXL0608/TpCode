import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { TpUserTable } from "./user.sql"

export const TpSessionTokenTable = sqliteTable(
  "tp_session_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull().unique(),
    token_type: text().notNull(),
    expires_at: integer().notNull(),
    revoked_at: integer(),
    ip: text(),
    user_agent: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("tp_session_token_user_idx").on(table.user_id),
    index("tp_session_token_expires_idx").on(table.expires_at),
  ],
)
