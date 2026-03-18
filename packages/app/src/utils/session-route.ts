/** 中文注释：生成普通会话入口路由，供“打开产品”这类需要恢复最近会话的场景使用。 */
export function sessionHref(directory: string, product_id?: string) {
  const query = new URLSearchParams()
  if (product_id) query.set("product", product_id)
  const value = query.toString()
  return value ? `/${directory}/session?${value}` : `/${directory}/session`
}

/** 中文注释：为显式新建会话生成唯一 fresh_key，确保在新会话页再次点击时也会触发页面重置。 */
export function freshSessionKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 中文注释：显式创建新会话时统一带上 fresh 标记，避免被产品侧栏的“恢复最近会话”逻辑立刻重定向回旧会话。 */
export function freshSessionHref(directory: string, product_id?: string, fresh_key?: string) {
  const query = new URLSearchParams()
  query.set("fresh", "1")
  if (fresh_key) query.set("fresh_key", fresh_key)
  if (product_id) query.set("product", product_id)
  return `/${directory}/session?${query.toString()}`
}

/** 中文注释：产品模式下优先沿用当前路由里的产品标识，缺失时再回退登录上下文产品。 */
export function sessionProductID(search: string, fallback_product_id?: string) {
  const product_id = new URLSearchParams(search).get("product")?.trim()
  return product_id || fallback_product_id
}

/** 中文注释：通用“新建会话”入口统一保留当前产品标识，避免产品模式里跳到无产品上下文的新会话。 */
export function freshSessionContextHref(input: {
  directory: string
  search: string
  fallback_product_id?: string
  fresh_key?: string
}) {
  return freshSessionHref(input.directory, sessionProductID(input.search, input.fallback_product_id), input.fresh_key)
}

/** 中文注释：判断当前路由是否是显式新会话请求，供布局层跳过自动恢复最近会话。 */
export function isFreshSessionSearch(search: string) {
  return new URLSearchParams(search).get("fresh") === "1"
}
