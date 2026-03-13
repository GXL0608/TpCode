/** 中文注释：仅允许超级管理员在 Session Context 中查看原始消息内容。 */
export function canViewSessionRawMessages(roles?: string[]) {
  return !!roles?.includes("super_admin")
}
