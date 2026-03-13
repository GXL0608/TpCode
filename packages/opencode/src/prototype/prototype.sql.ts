import { SessionTable } from "@/session/session.sql"
import { boolean_int, index, integer, table, text, uniqueIndex } from "@/storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"
import { TpDepartmentTable } from "@/user/department.sql"
import { TpOrganizationTable } from "@/user/organization.sql"
import { TpUserTable } from "@/user/user.sql"

export const TpPrototypeAssetTable = table(
  "tp_prototype_asset",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text(),
    user_id: text().references(() => TpUserTable.id, { onDelete: "set null" }),
    org_id: text().references(() => TpOrganizationTable.id, { onDelete: "set null" }),
    department_id: text().references(() => TpDepartmentTable.id, { onDelete: "set null" }),
    agent_mode: text().notNull(),
    title: text().notNull(),
    description: text(),
    route: text(),
    page_key: text().notNull(),
    viewport_width: integer(),
    viewport_height: integer(),
    device_scale_factor: integer(),
    mime: text().notNull(),
    size_bytes: integer().notNull(),
    storage_driver: text().notNull(),
    storage_key: text().notNull(),
    image_url: text(),
    thumbnail_url: text(),
    source_type: text().notNull(),
    source_url: text(),
    test_run_id: text(),
    test_result: text(),
    version: integer().notNull(),
    is_latest: boolean_int()
      .notNull()
      .$default(() => true),
    status: text()
      .notNull()
      .$default(() => "ready"),
    ...Timestamps,
  },
  (table) => [
    index("tp_prototype_asset_session_idx").on(table.session_id),
    index("tp_prototype_asset_message_idx").on(table.message_id),
    index("tp_prototype_asset_user_idx").on(table.user_id),
    index("tp_prototype_asset_org_idx").on(table.org_id),
    index("tp_prototype_asset_page_idx").on(table.session_id, table.page_key),
    index("tp_prototype_asset_latest_idx").on(table.session_id, table.page_key, table.is_latest),
    index("tp_prototype_asset_status_idx").on(table.status),
    index("tp_prototype_asset_created_idx").on(table.time_created),
    uniqueIndex("tp_prototype_asset_session_page_version_uidx").on(table.session_id, table.page_key, table.version),
  ],
)
