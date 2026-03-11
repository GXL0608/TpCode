import { type AccountRole } from "./settings-rbac-zh"

export function filterRoles(roles: AccountRole[], query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return roles
  return roles.filter((item) => {
    const name = item.name.trim().toLowerCase()
    return item.code.toLowerCase().includes(value) || name.includes(value)
  })
}
