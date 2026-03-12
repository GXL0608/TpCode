import { roleZh, type AccountRole } from "./settings-rbac-zh"
import { summarizeRoles } from "./settings-users-filter"

/** 根据角色编码列表解析对应的显示名称。 */
export function resolveRoleNames(codes: string[], roles: AccountRole[]) {
  const map = new Map(roles.map((item) => [item.code, item.name?.trim() || roleZh(item.code)]))
  return codes.map((code) => map.get(code) || roleZh(code))
}

/** 生成新增用户角色选择器的触发区摘要文案。 */
export function summarizeRolePicker(codes: string[], roles: AccountRole[]) {
  return summarizeRoles(codes, resolveRoleNames(codes, roles))
}

/** 构造新增用户请求体，确保清空角色后仍按既有协议提交。 */
export function buildCreateUserBody(input: {
  username: string
  password: string
  display_name: string
  phone: string
  account_type: "internal" | "hospital" | "partner"
  org_id: string
  can_role: boolean
  role_codes: string[]
}) {
  return {
    username: input.username.trim(),
    password: input.password,
    display_name: input.display_name.trim() || undefined,
    phone: input.phone.trim(),
    account_type: input.account_type,
    org_id: input.org_id,
    role_codes: input.can_role ? input.role_codes : undefined,
    force_password_reset: true,
  }
}
