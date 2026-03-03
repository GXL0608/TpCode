import { table, text, integer, boolean_int, primaryKey, uniqueIndex } from "../storage/orm-core"
import { eq } from "drizzle-orm"
import { Timestamps } from "@/storage/schema.sql"

export const ControlAccountTable = table(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().notNull(),
    refresh_token: text().notNull(),
    token_expiry: integer(),
    active: boolean_int()
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.email, table.url] }),
    // uniqueIndex("control_account_active_idx").on(table.email).where(eq(table.active, true)),
  ],
)
