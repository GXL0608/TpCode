/** 中文注释：判断运行模型选择器是否可见，超级管理员默认拥有 Build 能力。 */
export function canUseRuntimeModelSelector(input: { hasBuild: boolean; isSuperAdmin: boolean; agent?: string }) {
  return input.hasBuild || input.isSuperAdmin
}
