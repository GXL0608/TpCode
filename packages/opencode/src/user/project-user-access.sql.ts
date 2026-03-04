import { index, primaryKey, table, text, integer } from "../storage/orm-core"
import { ProjectTable } from "@/project/project.sql"
import { TpUserTable } from "./user.sql"

export const TpProjectUserAccessTable = table(
  "tp_project_user_access",
  {
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    user_id: text()
      .notNull()
      .references(() => TpUserTable.id, { onDelete: "cascade" }),
    mode: text()
      .notNull()
      .$default(() => "allow"),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.user_id], name: "tp_project_user_access_pk" }),
    index("tp_project_user_access_project_idx").on(table.project_id),
    index("tp_project_user_access_user_idx").on(table.user_id),
    index("tp_project_user_access_mode_idx").on(table.mode),
  ],
)
