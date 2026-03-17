import { directoryKey } from "@/context/project-resolver"
import { productProjectIDs } from "@/context/account-project"

type ProductLike = {
  id: string
  name?: string
  project_id?: string
  related_project_ids?: string[]
  selected?: boolean
  last_selected?: boolean
}

type ProjectLike = {
  id: string
  worktree: string
}

type LastSessionLike = {
  directory: string
  session_id: string
}

/** 中文注释：产品侧栏统一按产品关联项目与最近会话目录推导需要展示/预加载的目录集合。 */
export function productSidebarDirectories(input: {
  product?: ProductLike
  projects: readonly ProjectLike[]
  current_directory?: string
  last_session_by_project: Record<string, LastSessionLike | undefined>
}) {
  const ids = productProjectIDs(input.product)
  const roots = ids
    .map((project_id) => input.projects.find((item) => item.id === project_id)?.worktree)
    .filter((item): item is string => !!item)
  const remembered = ids
    .map((project_id) => input.last_session_by_project[project_id]?.directory)
    .filter((item): item is string => !!item)
  const current = input.current_directory ? [input.current_directory] : []
  return [...current, ...remembered, ...roots].filter(
    (directory, index, list) => list.findIndex((item) => directoryKey(item) === directoryKey(directory)) === index,
  )
}

/** 中文注释：产品侧栏显示的产品名称优先使用产品名，缺失时回退到产品编号。 */
export function productSidebarName(product?: ProductLike) {
  return product?.name?.trim() || product?.id || ""
}

/** 中文注释：产品头像统一取名称首字，避免把内部解决方案图标继续暴露给用户。 */
export function productSidebarAvatar(product?: ProductLike) {
  const name = productSidebarName(product)
  return name.slice(0, 1).toUpperCase() || "P"
}

/** 中文注释：产品接口短暂失败时，侧栏至少要保留当前产品占位，避免用户看到整列空白。 */
export function productSidebarProducts(input: {
  products: readonly ProductLike[]
  current_product_id?: string
}) {
  if (input.products.length > 0) return input.products
  if (!input.current_product_id) return [] as ProductLike[]
  return [
    {
      id: input.current_product_id,
      name: "当前产品",
      selected: true,
      last_selected: true,
    },
  ]
}

/** 中文注释：产品上下文存在时，左侧用户导航必须切到产品视图，不能继续暴露解决方案项目。 */
export function useProductSidebar(current_product_id?: string) {
  return !!current_product_id
}

/** 中文注释：产品导航项按选中态返回不同样式，确保用户能直观看到当前产品。 */
export function productSidebarItemClass(selected: boolean) {
  if (selected) {
    return "flex items-center justify-center size-10 rounded-lg border-2 border-brand-solid bg-surface-panel text-text-strong"
  }
  return "flex items-center justify-center size-10 rounded-lg border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base text-text-base"
}
