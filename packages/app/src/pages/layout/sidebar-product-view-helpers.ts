import { directoryKey, resolveProjectByDirectory } from "@/context/project-resolver"
import { productProjectIDs, productSessionDirectoryMatches, productSharesProjects } from "@/context/account-project"
import type { GlobalSession, Session } from "@opencode-ai/sdk/v2/client"

type ProductLike = {
  id: string
  name?: string
  project_id?: string
  related_project_ids?: string[]
  selected?: boolean
  last_selected?: boolean
}

const PRODUCT_SIDEBAR_VISIBLE_LIMIT = 5

type ProjectLike = {
  id: string
  worktree: string
  sandboxes?: string[]
}

type LastSessionLike = {
  directory: string
  session_id: string
  time_updated?: number
}

/** 中文注释：产品侧栏统一按产品关联项目与最近会话目录推导需要展示/预加载的目录集合。 */
export function productSidebarDirectories(input: {
  product?: ProductLike
  products?: readonly ProductLike[]
  projects: readonly ProjectLike[]
  last_session_by_product: Record<string, LastSessionLike | undefined>
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
  const rememberedDirectory = input.product?.id ? input.last_session_by_product[input.product.id]?.directory : undefined
  const productRemembered =
    productSharesProjects({ product: input.product, products: input.products }) && !productSessionDirectoryMatches(input.product?.id, rememberedDirectory)
      ? undefined
      : rememberedDirectory
  const current = productSidebarCurrentDirectory({
    product: input.product,
    products: input.products,
    projects: input.projects,
    last_session_by_product: input.last_session_by_product,
    current_directory: input.current_directory,
    last_session_by_project: input.last_session_by_project,
  })
  if (productSharesProjects({ product: input.product, products: input.products }) && !productRemembered) {
    return current
  }
  const preferred = [...current, ...(productRemembered ? [productRemembered] : remembered)].filter(
    (directory, index, list) => list.findIndex((item) => directoryKey(item) === directoryKey(directory)) === index,
  )
  if (preferred.length > 0) return preferred
  return roots.filter(
    (directory, index, list) => list.findIndex((item) => directoryKey(item) === directoryKey(directory)) === index,
  )
}

/** 中文注释：产品切换时只允许把当前目录带入当前产品，避免旧产品会话污染新产品侧栏。 */
export function productSidebarCurrentDirectory(input: {
  product?: ProductLike
  products?: readonly ProductLike[]
  projects: readonly ProjectLike[]
  last_session_by_product: Record<string, LastSessionLike | undefined>
  current_directory?: string
  last_session_by_project: Record<string, LastSessionLike | undefined>
}) {
  if (!input.current_directory) return [] as string[]
  const productRemembered = input.product?.id ? input.last_session_by_product[input.product.id]?.directory : undefined
  if (productRemembered && directoryKey(productRemembered) === directoryKey(input.current_directory)) {
    return [input.current_directory]
  }
  if (productSharesProjects({ product: input.product, products: input.products })) return [] as string[]
  const ids = productProjectIDs(input.product)
  if (ids.length === 0) return [] as string[]
  const remembered = ids
    .map((project_id) => input.last_session_by_project[project_id]?.directory)
    .filter((item): item is string => !!item)
  if (remembered.some((directory) => directoryKey(directory) === directoryKey(input.current_directory!))) {
    return [input.current_directory]
  }
  const project = resolveProjectByDirectory(
    input.projects.map((item) => ({ ...item, sandboxes: item.sandboxes ?? [] })),
    input.current_directory,
  )
  if (!project?.id) return [] as string[]
  if (!ids.includes(project.id)) return [] as string[]
  return [input.current_directory]
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
function productSidebarFallback(input: {
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

/** 中文注释：按“最近使用优先，其余保持原始顺序”的规则生成稳定的产品导航顺序。 */
function orderedProducts(input: {
  products: readonly ProductLike[]
  recent_product_ids?: readonly string[]
}) {
  const products = [...input.products]
  if (!input.recent_product_ids?.length) return products
  const map = new Map(products.map((item) => [item.id, item]))
  const recent = input.recent_product_ids.map((id) => map.get(id)).filter((item): item is ProductLike => !!item)
  const visible = new Set(recent.map((item) => item.id))
  return [...recent, ...products.filter((item) => !visible.has(item.id))]
}

/** 中文注释：产品侧栏默认只展示最近使用的产品，并确保当前产品即使不在最近列表里也始终可见。 */
export function productSidebarProducts(input: {
  products: readonly ProductLike[]
  current_product_id?: string
  recent_product_ids?: readonly string[]
}) {
  const products = productSidebarFallback(input)
  if (products.length <= PRODUCT_SIDEBAR_VISIBLE_LIMIT) return products
  const ordered = orderedProducts({
    products,
    recent_product_ids: input.recent_product_ids,
  })
  const visible = ordered.slice(0, PRODUCT_SIDEBAR_VISIBLE_LIMIT)
  if (!input.current_product_id) return visible
  if (visible.some((item) => item.id === input.current_product_id)) return visible
  const current = ordered.find((item) => item.id === input.current_product_id)
  if (!current) return visible
  return [...visible, current]
}

/** 中文注释：把未进入最近产品栏的剩余产品收进“更多”列表，避免左侧导航被全部产品占满。 */
export function productSidebarOverflowProducts(input: {
  products: readonly ProductLike[]
  current_product_id?: string
  recent_product_ids?: readonly string[]
}) {
  const products = productSidebarFallback(input)
  const visible = new Set(
    productSidebarProducts({
      products,
      current_product_id: input.current_product_id,
      recent_product_ids: input.recent_product_ids,
    }).map((item) => item.id),
  )
  return orderedProducts({
    products,
    recent_product_ids: input.recent_product_ids,
  }).filter((item) => !visible.has(item.id))
}

export type ProductSidebarSessionBase = {
  id: string
  directory: string
  parentID?: string
  contextProductID?: string
  time?: Session["time"]
}

export type ProductSidebarSessionInfo = GlobalSession & {
  contextProductID?: string
}

/** 中文注释：产品侧栏直接按当前产品上下文筛选会话，避免继续从目录拼接导致只显示一条或串到其它产品。 */
export function productSidebarSessions<T extends ProductSidebarSessionBase>(input: {
  sessions: readonly T[]
  product_id?: string
  sort: (a: T, b: T) => number
}) {
  const children = new Map<string, string[]>()
  for (const session of input.sessions) {
    if (!session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session.id)
    children.set(session.parentID, list)
  }
  return input.sessions
    .filter((session) => {
      if (session.parentID) return false
      if (session.time?.archived) return false
      if (!input.product_id) return true
      if (session.contextProductID) return session.contextProductID === input.product_id
      return productSessionDirectoryMatches(input.product_id, session.directory)
    })
    .sort(input.sort)
    .slice(0, 10)
    .map((session) => ({
      session,
      children,
    }))
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
