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
  // 中文注释：整条 provider 被用户逻辑删除后的时间戳映射。
  provider_deleted_json: text({ mode: "json" }).$type<Record<string, number>>(),
  // 中文注释：provider 认证被用户逻辑删除后的快照映射。
  provider_auth_deleted_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  // 中文注释：provider 配置被用户逻辑删除后的快照映射。
  provider_config_deleted_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
})
