type SolutionLike = {
  id: string
}

type ProductLike = {
  id: string
  solutions?: SolutionLike[]
}

/** 中文注释：决定构建中心本次请求使用哪份产品列表，筛选切换时优先保留当前列表避免下拉框被重建。 */
export function resolveBuildCenterProducts<T extends ProductLike>(current: T[], incoming: T[], refresh: boolean) {
  if (refresh) return incoming
  if (current.length > 0) return current
  return incoming
}

/** 中文注释：同步构建中心的产品与解决方案筛选，优先保留用户显式选择的产品。 */
export function syncBuildCenterFilters(products: ProductLike[], product_id: string, solution_id: string) {
  if (products.length === 0) {
    return {
      product_id: "",
      solution_id: "",
    }
  }
  const next_product_id = products.some((item) => item.id === product_id) ? product_id : products[0]!.id
  const product = products.find((item) => item.id === next_product_id)
  const next_solution_id = product?.solutions?.some((item) => item.id === solution_id) ? solution_id : ""
  return {
    product_id: next_product_id,
    solution_id: next_solution_id,
  }
}
