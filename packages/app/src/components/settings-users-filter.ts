import { type AccountRole } from "./settings-rbac-zh"

/** 按角色名称或编码过滤角色列表。 */
export function filterRoles(roles: AccountRole[], query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return roles
  return roles.filter((item) => {
    const name = item.name.trim().toLowerCase()
    return item.code.toLowerCase().includes(value) || name.includes(value)
  })
}

/** 生成新增用户弹窗里角色多选触发区的摘要文案。 */
export function summarizeRoles(codes: string[], names: string[]) {
  if (codes.length === 0) return "请选择初始角色"
  const text = names.slice(0, 2).join("、")
  return `已选 ${codes.length} 项：${text}${codes.length > 2 ? "…" : ""}`
}
