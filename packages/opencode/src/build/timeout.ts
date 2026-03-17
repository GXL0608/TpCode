const DEFAULT_CODING_TIMEOUT_MS = 600000

/** 中文注释：把毫秒超时值格式化成对用户更友好的中文秒数描述，至少显示 1 秒。 */
export function timeoutText(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  return `${seconds} 秒`
}

/** 中文注释：解析改码阶段超时配置，默认 10 分钟，并兜底非法或非正数配置。 */
export function codingTimeout(value = process.env.TPCODE_BUILD_CODING_TIMEOUT_MS) {
  const next = Number(value ?? `${DEFAULT_CODING_TIMEOUT_MS}`)
  if (!Number.isFinite(next) || next <= 0) return DEFAULT_CODING_TIMEOUT_MS
  return next
}
