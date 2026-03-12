import { table, text } from "../storage/orm-core"
import { TpUserTable } from "./user.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TpUserProviderSettingTable = table("tp_user_provider_setting", {
  user_id: text()
    .primaryKey()
    .references(() => TpUserTable.id, { onDelete: "cascade" }),
  provider_auth_cipher: text(),
  provider_control_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  provider_configs_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
})
