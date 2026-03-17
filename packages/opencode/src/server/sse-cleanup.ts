type Input = {
  onClosed?: () => void
  tasks: Array<() => void>
}

/** 中文注释：创建 SSE 连接的幂等清理器，确保异常关闭和正常断开都只释放一次资源。 */
export function createSSECleanup(input: Input) {
  let done = false

  return () => {
    if (done) return false
    done = true
    input.onClosed?.()
    for (const task of input.tasks) task()
    return true
  }
}
