import { getFilename } from "@opencode-ai/util/path"

export const workspaceOpenState = (expanded: Record<string, boolean>, directory: string, local: boolean) =>
  expanded[directory] ?? local

/** 中文注释：根据权限决定左侧工作区显示名称，普通用户不暴露分支来源信息。 */
export const workspaceVisibleName = (input: {
  directory: string
  branch?: string
  alias?: string
  local: boolean
  superAdmin: boolean
}) => {
  if (input.local) {
    if (!input.superAdmin) return
    return input.branch ?? getFilename(input.directory)
  }
  if (input.alias) return input.alias
  if (input.superAdmin) return input.branch ?? getFilename(input.directory)
  return getFilename(input.directory)
}
