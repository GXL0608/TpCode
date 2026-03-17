import { getFilename } from "@opencode-ai/util/path"
import { productProjectIDs } from "@/context/account-project"
import { directoryKey } from "@/context/project-resolver"

type ProductRoot = {
  directory: string
  enabled?: boolean
  meta?: {
    directories?: string[]
  }
}

type ProductSolution = {
  roots?: ProductRoot[]
}

type ProductLike = {
  id: string
  name?: string
  project_id?: string
  related_project_ids?: string[]
  worktree?: string
  paths?: string[]
  solutions?: ProductSolution[]
}

type ProjectLike = {
  id?: string
  name?: string
  worktree: string
  sandboxes?: string[]
}

/** 中文注释：产品侧栏优先展示后端返回的路径摘要；旧数据再回退到解决方案 roots。 */
export function productContextPaths(product?: ProductLike) {
  if (!product) return []
  const paths = [...new Set((product.paths ?? []).map((item) => item.trim()).filter(Boolean))]
  if (paths.length > 0) return paths
  const roots = (product.solutions ?? []).flatMap((solution) =>
    (solution.roots ?? [])
      .filter((root) => root.enabled !== false)
      .flatMap((root) => [root.directory, ...(root.meta?.directories ?? [])])
      .map((item) => item.trim())
      .filter(Boolean),
  )
  if (roots.length > 0) return [...new Set(roots)]
  if (!product.worktree) return []
  return [product.worktree]
}

/** 中文注释：当前目录仍落在锚点项目时，优先按产品上下文决定侧栏标题和解决方案路径展示。 */
export function sidebarProductContext(input: {
  product?: ProductLike
  project?: ProjectLike
  current_directory?: string
}) {
  const paths = productContextPaths(input.product)
  if (!input.product || paths.length === 0) return
  const current = input.current_directory ? directoryKey(input.current_directory) : undefined
  const project = input.project
  const projectMatch =
    !!project &&
    (productProjectIDs(input.product).includes(project.id ?? "") ||
      paths.some((item) => directoryKey(item) === directoryKey(project.worktree)))
  const currentMatch =
    !!current &&
    ([input.product.worktree, ...paths].filter(Boolean) as string[]).some((item) => directoryKey(item) === current)
  if (!projectMatch && !currentMatch) return
  return {
    name: input.product.name?.trim() || project?.name?.trim() || getFilename(project?.worktree ?? paths[0]),
    paths,
  }
}
