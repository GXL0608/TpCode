import { index, integer, boolean_int, table, text, uniqueIndex } from "../storage/orm-core"
import { TpDepartmentTable } from "./department.sql"
import { TpOrganizationTable } from "./organization.sql"
import { Timestamps } from "@/storage/schema.sql"
import { isNull } from "drizzle-orm"

export const TpUserTable = table(
  "tp_user",
  {
    id: text().primaryKey(),
    username: text().notNull(),
    password_hash: text().notNull(),
    display_name: text().notNull(),
    email: text(),
    phone: text(),
    account_type: text().notNull(),
    org_id: text()
      .notNull()
      .references(() => TpOrganizationTable.id, { onDelete: "cascade" }),
    department_id: text().references(() => TpDepartmentTable.id, { onDelete: "set null" }),
    customer_id: text(),
    customer_name: text(),
    customer_department_id: text(),
    customer_department_name: text(),
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
    // 中文注释：逻辑删除时间；为空表示仍然有效。
    time_deleted: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_user_username_unique").on(table.username).where(isNull(table.time_deleted)),
    index("tp_user_org_idx").on(table.org_id),
    index("tp_user_department_idx").on(table.department_id),
    index("tp_user_status_idx").on(table.status),
    index("tp_user_deleted_idx").on(table.time_deleted),
  ],
)
