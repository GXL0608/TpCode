/** 中文注释：显式创建新会话时统一带上 fresh 标记，避免被产品侧栏的“恢复最近会话”逻辑立刻重定向回旧会话。 */
export function freshSessionHref(directory: string, product_id?: string) {
  const query = new URLSearchParams()
  query.set("fresh", "1")
  if (product_id) query.set("product", product_id)
  return `/${directory}/session?${query.toString()}`
}

/** 中文注释：判断当前路由是否是显式新会话请求，供布局层跳过自动恢复最近会话。 */
export function isFreshSessionSearch(search: string) {
  return new URLSearchParams(search).get("fresh") === "1"
}
