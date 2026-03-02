import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import { TpDepartmentTable } from "@/user/department.sql"
import { TpOrganizationTable } from "@/user/organization.sql"
import { TpUserTable } from "@/user/user.sql"

export const TpChangeRequestTable = sqliteTable(
  "tp_change_request",
  {
    id: text().primaryKey(),
    page_id: text(),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    org_id: text()
      .notNull()
      .references(() => TpOrganizationTable.id, { onDelete: "cascade" }),
    department_id: text().references(() => TpDepartmentTable.id, { onDelete: "set null" }),
    title: text().notNull(),
    description: text().notNull(),
    ai_plan: text(),
    ai_prototype_url: text(),
    ai_score: integer(),
    ai_revenue_assessment: text(),
    status: text()
      .notNull()
      .$default(() => "draft"),
    current_step: integer()
      .notNull()
      .$default(() => 0),
    confirmed_at: integer(),
    submitted_at: integer(),
    approved_at: integer(),
    rejected_at: integer(),
    executing_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("tp_change_request_user_idx").on(table.user_id),
    index("tp_change_request_org_idx").on(table.org_id),
    index("tp_change_request_department_idx").on(table.department_id),
    index("tp_change_request_status_idx").on(table.status),
    index("tp_change_request_session_idx").on(table.session_id),
  ],
)
