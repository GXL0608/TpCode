/** 中文注释：判断个人模型配置页是否应该显示系统候选只读信息。 */
export function canViewReadonlySystemCandidates(input: { isSelf: boolean; roles: string[] }) {
  if (!input.isSelf) return false
  return input.roles.includes("super_admin")
}
