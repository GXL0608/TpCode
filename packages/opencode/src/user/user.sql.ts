import { index, integer, boolean_int, table, text } from "../storage/orm-core"
import { TpDepartmentTable } from "./department.sql"
import { TpOrganizationTable } from "./organization.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpUserTable = table(
  "tp_user",
  {
    id: text().primaryKey(),
    username: text().notNull().unique(),
    password_hash: text().notNull(),
    display_name: text().notNull(),
    email: text(),
    phone: text(),
    account_type: text().notNull(),
    org_id: text()
      .notNull()
      .references(() => TpOrganizationTable.id, { onDelete: "cascade" }),
    department_id: text().references(() => TpDepartmentTable.id, { onDelete: "set null" }),
    status: text()
      .notNull()
      .$default(() => "active"),
    force_password_reset: boolean_int()
      .notNull()
      .$default(() => true),
    failed_login_count: integer()
      .notNull()
      .$default(() => 0),
    locked_until: integer(),
    vho_user_id: text(),
    external_source: text(),
    last_login_at: integer(),
    last_login_ip: text(),
    ...Timestamps,
  },
  (table) => [
    index("tp_user_org_idx").on(table.org_id),
    index("tp_user_department_idx").on(table.department_id),
    index("tp_user_status_idx").on(table.status),
  ],
)
