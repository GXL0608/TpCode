import { pgTable, bigint, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core"

export const AppEventLogTable = pgTable("app_event_log", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  level: text().notNull(),
  service: text().notNull(),
  event: text().notNull(),
  message: text().notNull(),
  status: text().notNull(),
  duration_ms: integer(),
  request_id: text(),
  session_id: text(),
  message_id: text(),
  user_id: text(),
  project_id: text(),
  workspace_id: text(),
  provider_id: text(),
  model_id: text(),
  agent: text(),
  count: integer().notNull().default(1),
  tags: jsonb().$type<Record<string, string>>().notNull().default({}),
  extra: jsonb().$type<Record<string, unknown>>().notNull().default({}),
})
