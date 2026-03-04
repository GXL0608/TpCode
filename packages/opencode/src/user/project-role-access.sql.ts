import { index, primaryKey, table, text, integer } from "../storage/orm-core"
import { ProjectTable } from "@/project/project.sql"
import { TpRoleTable } from "./role.sql"

export const TpProjectRoleAccessTable = table(
  "tp_project_role_access",
  {
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    role_id: text()
      .notNull()
      .references(() => TpRoleTable.id, { onDelete: "cascade" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.role_id], name: "tp_project_role_access_pk" }),
    index("tp_project_role_access_project_idx").on(table.project_id),
    index("tp_project_role_access_role_idx").on(table.role_id),
  ],
)
