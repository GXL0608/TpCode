import { getFilename } from "@opencode-ai/util/path"

export const workspaceOpenState = (expanded: Record<string, boolean>, directory: string, local: boolean) =>
  expanded[directory] ?? local

/** 中文注释：统一计算左侧工作区显示名称，优先展示别名或分支，缺失时回退目录名。 */
export const workspaceVisibleName = (input: {
  directory: string
  branch?: string
  alias?: string
  local: boolean
}) => {
  if (input.local) return input.branch ?? getFilename(input.directory)
  if (input.alias) return input.alias
  return input.branch ?? getFilename(input.directory)
}
