import { table, text, integer } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { ProjectTable } from "@/project/project.sql"

export const TpUserProjectStateTable = table("tp_user_project_state", {
  user_id: text()
    .primaryKey()
    .references(() => TpUserTable.id, { onDelete: "cascade" }),
  last_project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
  open_project_ids: text({ mode: "json" }).$type<string[]>(),
  last_session_by_project: text({ mode: "json" }).$type<
    Record<
      string,
      {
        session_id: string
        directory: string
        time_updated: number
      }
    >
  >(),
  workspace_mode_by_project: text({ mode: "json" }).$type<Record<string, boolean>>(),
  workspace_order_by_project: text({ mode: "json" }).$type<Record<string, string[]>>(),
  workspace_expanded_by_directory: text({ mode: "json" }).$type<Record<string, boolean>>(),
  workspace_alias_by_project_branch: text({ mode: "json" }).$type<Record<string, Record<string, string>>>(),
  time_updated: integer()
    .notNull()
    .$default(() => Date.now()),
})
