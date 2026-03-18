type SessionBranchLike = {
  id: string
  parentID?: string
}

/** 中文注释：删除会话时需要连同整棵子会话树一起移除，保证侧栏与消息页不会残留孤儿会话。 */
export function removeSessionBranch<T extends SessionBranchLike>(sessions: readonly T[], sessionID: string) {
  const removed = new Set<string>([sessionID])
  const byParent = new Map<string, string[]>()

  for (const item of sessions) {
    if (!item.parentID) continue
    const list = byParent.get(item.parentID) ?? []
    list.push(item.id)
    byParent.set(item.parentID, list)
  }

  const stack = [sessionID]
  while (stack.length > 0) {
    const parentID = stack.pop()
    if (!parentID) continue
    const children = byParent.get(parentID)
    if (!children) continue
    for (const child of children) {
      if (removed.has(child)) continue
      removed.add(child)
      stack.push(child)
    }
  }

  return sessions.filter((item) => !removed.has(item.id))
}
