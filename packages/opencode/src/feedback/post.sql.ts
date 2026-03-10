import { boolean_int, index, table, text } from "@/storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpFeedbackThreadTable } from "./thread.sql"

export const TpFeedbackPostTable = table(
  "tp_feedback_post",
  {
    id: text().primaryKey(),
    thread_id: text()
      .notNull()
      .references(() => TpFeedbackThreadTable.id, { onDelete: "cascade" }),
    user_id: text().notNull(),
    username: text().notNull(),
    display_name: text().notNull(),
    org_id: text().notNull(),
    department_id: text(),
    content: text().notNull(),
    official_reply: boolean_int()
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [
    index("tp_feedback_post_thread_idx").on(table.thread_id),
    index("tp_feedback_post_user_idx").on(table.user_id),
    index("tp_feedback_post_official_idx").on(table.official_reply),
  ],
)
