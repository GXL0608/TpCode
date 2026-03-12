/** 中文注释：统一判断当前账号是否具备 Build 相关能力，超级管理员默认拥有该能力。 */
export function canUseBuildCapability(input?: { roles?: string[]; permissions?: string[] }) {
  if (!input) return false
  if (input.roles?.includes("super_admin")) return true
  return !!input.permissions?.includes("agent:use_build")
}
