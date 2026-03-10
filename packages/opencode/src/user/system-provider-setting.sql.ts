import { table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpSystemProviderSettingTable = table("tp_system_provider_setting", {
  id: text().primaryKey(),
  provider_control_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  provider_configs_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  provider_auth_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
})
