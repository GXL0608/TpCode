import { index, table, text, integer } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { ProjectTable } from "@/project/project.sql"

export const TpSessionTokenTable = table(
  "tp_session_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull().unique(),
    token_type: text().notNull(),
    context_project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
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
    index("tp_session_token_context_project_idx").on(table.context_project_id),
    index("tp_session_token_expires_idx").on(table.expires_at),
  ],
)
