import { table, text, uniqueIndex } from "../storage/orm-core"
import { ProjectTable } from "@/project/project.sql"
import type { Config } from "./config"
import type { BatchMeta, WorkspaceKind } from "./workspace-meta"

export const WorkspaceTable = table(
  "workspace",
  {
    id: text().primaryKey(),
    // 中文注释：工作区入口目录，单仓模式指向 worktree 根目录，批量模式指向聚合沙盒根目录。
    directory: text().notNull(),
    branch: text(),
    // 中文注释：工作区类型，用于区分单仓 worktree 与批量聚合沙盒。
    kind: text().notNull().$type<WorkspaceKind>(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    config: text({ mode: "json" }).notNull().$type<Config>(),
    // 中文注释：批量工作区成员元数据；单仓模式下为空。
    meta: text({ mode: "json" }).$type<BatchMeta>(),
  },
  (table) => [uniqueIndex("workspace_directory_uidx").on(table.directory)],
)
