/** 中文注释：产品上下文下，目录页应直接以产品会话工作区为准，不能再强行切回某一个解决方案项目锚点。 */
export function shouldAlignDirectoryProjectContext(input: {
  authenticated: boolean
  global_ready: boolean
  directory?: string
  context_product_id?: string
  target_project_id?: string
  current_project_id?: string
  aligning?: string
}) {
  if (!input.directory) return false
  if (!input.authenticated) return false
  if (!input.global_ready) return false
  if (input.context_product_id) return false
  if (!input.target_project_id) return false
  if (input.current_project_id === input.target_project_id) return false
  if (input.aligning === input.target_project_id) return false
  return true
}
