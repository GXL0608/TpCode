import { index, table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpOrganizationTable = table(
  "tp_organization",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    code: text().notNull().unique(),
    org_type: text().notNull(),
    status: text()
      .notNull()
      .$default(() => "active"),
    parent_id: text(),
    ...Timestamps,
  },
  (table) => [index("tp_organization_parent_idx").on(table.parent_id)],
)
