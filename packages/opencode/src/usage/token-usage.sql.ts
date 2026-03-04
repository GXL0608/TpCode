import { index, integer, table, text, uniqueIndex } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpTokenUsageTable = table(
  "tp_token_usage",
  {
    id: text().primaryKey(),
    usage_scene: text().notNull().$type<"step_finish" | "auto_title">(),
    source_id: text().notNull(),
    session_id: text().notNull(),
    message_id: text(),
    project_id: text().notNull(),
    workplace: text().notNull(),
    user_id: text(),
    username: text(),
    phone: text(),
    display_name: text(),
    account_type: text(),
    org_id: text(),
    department_id: text(),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    token_input: integer()
      .notNull()
      .$default(() => 0),
    token_output: integer()
      .notNull()
      .$default(() => 0),
    token_reasoning: integer()
      .notNull()
      .$default(() => 0),
    token_cache_read: integer()
      .notNull()
      .$default(() => 0),
    token_cache_write: integer()
      .notNull()
      .$default(() => 0),
    token_total: integer()
      .notNull()
      .$default(() => 0),
    cost_micros: integer()
      .notNull()
      .$default(() => 0),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("tp_token_usage_scene_source_uidx").on(table.usage_scene, table.source_id),
    index("tp_token_usage_time_idx").on(table.time_created),
    index("tp_token_usage_session_time_idx").on(table.session_id, table.time_created),
    index("tp_token_usage_message_time_idx").on(table.message_id, table.time_created),
    index("tp_token_usage_project_time_idx").on(table.project_id, table.time_created),
    index("tp_token_usage_user_time_idx").on(table.user_id, table.time_created),
    index("tp_token_usage_model_time_idx").on(table.model_id, table.time_created),
  ],
)
