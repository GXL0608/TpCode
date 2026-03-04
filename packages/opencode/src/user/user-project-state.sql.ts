import { table, text, integer } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { ProjectTable } from "@/project/project.sql"

export const TpUserProjectStateTable = table("tp_user_project_state", {
  user_id: text()
    .primaryKey()
    .references(() => TpUserTable.id, { onDelete: "cascade" }),
  last_project_id: text().references(() => ProjectTable.id, { onDelete: "set null" }),
  time_updated: integer()
    .notNull()
    .$default(() => Date.now()),
})
