type SolutionLike = {
  id: string
}

type ProductLike = {
  id: string
  name?: string
  solutions?: SolutionLike[]
}

/** 中文注释：统一按名称升序整理导航项，保证产品列表展示稳定可预期。 */
export function sortNamedItems<T extends { name?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const left = a.name ?? ""
    const right = b.name ?? ""
    const leftBucket = /^[a-z0-9]/i.test(left) ? 0 : 1
    const rightBucket = /^[a-z0-9]/i.test(right) ? 0 : 1
    if (leftBucket !== rightBucket) return leftBucket - rightBucket
    return left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
  })
}

/** 中文注释：按名称执行大小写不敏感检索，并始终返回排好序的结果。 */
export function filterNamedItems<T extends { name?: string }>(items: T[], keyword: string) {
  const query = keyword.trim().toLocaleLowerCase()
  const sorted = sortNamedItems(items)
  if (!query) return sorted
  return sorted.filter((item) => (item.name ?? "").toLocaleLowerCase().includes(query))
}

/** 中文注释：校正当前产品选中项，保证列表刷新后始终落在有效产品上。 */
export function syncProductSelection(products: ProductLike[], current: string) {
  if (products.length === 0) return ""
  if (products.some((item) => item.id === current)) return current
  return products[0]!.id
}

/** 中文注释：校正当前解决方案选中项，切换产品后自动回退到当前产品的首个方案。 */
export function syncSolutionSelection(product: ProductLike | undefined, current: string) {
  const solutions = product?.solutions ?? []
  if (solutions.length === 0) return ""
  if (solutions.some((item) => item.id === current)) return current
  return solutions[0]!.id
}

/** 中文注释：生成左侧产品导航项的样式，突出当前选中产品。 */
export function productItemClass(selected: boolean) {
  return selected
    ? "border-brand-solid bg-brand-solid/10 shadow-[0_8px_30px_rgba(15,118,110,0.12)]"
    : "border-border-weak-base bg-surface-base hover:border-border-weak-base hover:bg-surface-panel/60"
}

/** 中文注释：生成解决方案导航项的样式，保证选中方案在右侧区域中也有明显反馈。 */
export function solutionItemClass(selected: boolean) {
  return selected
    ? "border-brand-solid bg-brand-solid/10 text-text-strong"
    : "border-border-weak-base bg-surface-base hover:bg-surface-panel/60 text-text-weak"
}

/** 中文注释：返回项目管理页主从布局的样式类，确保在设置弹窗常见宽度下即可进入左右结构。 */
export function projectsLayoutClass() {
  return "grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]"
}

/** 中文注释：返回解决方案区的双栏布局样式类，让列表与详情在右侧区域稳定并排展示。 */
export function projectsSolutionLayoutClass() {
  return "grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"
}
