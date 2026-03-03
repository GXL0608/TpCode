import { index, integer, table, text } from "../storage/orm-core"
import { TpOrganizationTable } from "./organization.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpDepartmentTable = table(
  "tp_department",
  {
    id: text().primaryKey(),
    org_id: text()
      .notNull()
      .references(() => TpOrganizationTable.id, { onDelete: "cascade" }),
    parent_id: text(),
    name: text().notNull(),
    code: text(),
    sort_order: integer()
      .notNull()
      .$default(() => 0),
    status: text()
      .notNull()
      .$default(() => "active"),
    ...Timestamps,
  },
  (table) => [
    index("tp_department_org_idx").on(table.org_id),
    index("tp_department_parent_idx").on(table.parent_id),
    index("tp_department_code_idx").on(table.code),
  ],
)
