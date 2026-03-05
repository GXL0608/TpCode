import { index, primaryKey, table, text, integer } from "../storage/orm-core"
import { TpProductTable } from "./product.sql"
import { TpRoleTable } from "./role.sql"

export const TpRoleProductAccessTable = table(
  "tp_role_product_access",
  {
    product_id: text()
      .notNull()
      .references(() => TpProductTable.id, { onDelete: "cascade" }),
    role_id: text()
      .notNull()
      .references(() => TpRoleTable.id, { onDelete: "cascade" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.product_id, table.role_id], name: "tp_role_product_access_pk" }),
    index("tp_role_product_access_product_idx").on(table.product_id),
    index("tp_role_product_access_role_idx").on(table.role_id),
  ],
)
