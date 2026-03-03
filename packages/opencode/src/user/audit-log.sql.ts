import { index, table, text, integer } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"

export const TpAuditLogTable = table(
  "tp_audit_log",
  {
    id: text().primaryKey(),
    actor_user_id: text().references(() => TpUserTable.id, { onDelete: "set null" }),
    action: text().notNull(),
    target_type: text().notNull(),
    target_id: text(),
    result: text().notNull(),
    detail_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ip: text(),
    user_agent: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("tp_audit_log_actor_idx").on(table.actor_user_id), index("tp_audit_log_action_idx").on(table.action)],
)
