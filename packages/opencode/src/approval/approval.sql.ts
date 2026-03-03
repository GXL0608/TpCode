import { index, integer, table, text, uniqueIndex } from "../storage/orm-core"
import { TpChangeRequestTable } from "./change-request.sql"
import { TpUserTable } from "@/user/user.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpApprovalTable = table(
  "tp_approval",
  {
    id: text().primaryKey(),
    change_request_id: text()
      .notNull()
      .references(() => TpChangeRequestTable.id, { onDelete: "cascade" }),
    reviewer_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    step_order: integer().notNull(),
    status: text()
      .notNull()
      .$default(() => "pending"),
    comment: text(),
    reviewed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_approval_change_step_uidx").on(table.change_request_id, table.step_order),
    index("tp_approval_change_idx").on(table.change_request_id),
    index("tp_approval_reviewer_idx").on(table.reviewer_id),
    index("tp_approval_status_idx").on(table.status),
  ],
)
