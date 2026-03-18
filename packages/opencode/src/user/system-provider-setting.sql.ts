import { table, text } from "../storage/orm-core"
import { Timestamps } from "@/storage/schema.sql"

export const TpSystemProviderSettingTable = table("tp_system_provider_setting", {
  id: text().primaryKey(),
  provider_control_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  provider_configs_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  provider_auth_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  // 中文注释：整条 provider 被系统逻辑删除后的时间戳映射。
  provider_deleted_json: text({ mode: "json" }).$type<Record<string, number>>(),
  // 中文注释：provider 认证被系统逻辑删除后的快照映射。
  provider_auth_deleted_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  // 中文注释：provider 配置被系统逻辑删除后的快照映射。
  provider_config_deleted_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
})
