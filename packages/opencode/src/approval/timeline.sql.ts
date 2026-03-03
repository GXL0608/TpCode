import { index, integer, table, text } from "../storage/orm-core"
import { TpChangeRequestTable } from "./change-request.sql"
import { TpUserTable } from "@/user/user.sql"

export const TpTimelineTable = table(
  "tp_timeline",
  {
    id: text().primaryKey(),
    change_request_id: text()
      .notNull()
      .references(() => TpChangeRequestTable.id, { onDelete: "cascade" }),
    actor_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    detail: text(),
    attachment_url: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("tp_timeline_change_request_idx").on(table.change_request_id),
    index("tp_timeline_actor_idx").on(table.actor_id),
    index("tp_timeline_action_idx").on(table.action),
  ],
)
