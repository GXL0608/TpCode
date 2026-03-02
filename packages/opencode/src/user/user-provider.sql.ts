import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { TpUserTable } from "./user.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpUserProviderTable = sqliteTable(
  "tp_user_provider",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    auth_type: text().notNull(),
    secret_cipher: text().notNull(),
    meta_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    is_active: integer({ mode: "boolean" })
      .notNull()
      .$default(() => true),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_user_provider_user_provider_uidx").on(table.user_id, table.provider_id),
    index("tp_user_provider_user_idx").on(table.user_id),
    index("tp_user_provider_provider_idx").on(table.provider_id),
  ],
)
