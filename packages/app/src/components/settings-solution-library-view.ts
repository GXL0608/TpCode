type SolutionLike = {
  id: string
  name?: string
}

type ProductLike = {
  id: string
  name: string
  project_id?: string
  worktree?: string
}

type RootLike = {
  root_type?: string
  directory?: string
  meta?: {
    directories?: string[]
  }
}

type BuildProfileLike = {
  workdirs?: string[]
  compile_command?: string
}

type SubmitLike = {
  pending: boolean
  name: string
  code: string
}

/** 中文注释：提取目录最后一级名称，兼容 Windows 与 POSIX 路径。 */
function leaf(input: string) {
  const value = input.trim().replaceAll("\\", "/").replace(/\/+$/g, "")
  return value.split("/").filter(Boolean).at(-1) || "workspace"
}

/** 中文注释：为新增解决方案生成默认草稿，确保管理员只补名称和编码即可先保存。 */
export function createSolutionDraft(product: ProductLike) {
  const directory = product.worktree?.trim() || product.project_id?.trim() || product.id
  const mount_name = leaf(directory)
  return {
    product_id: product.id,
    project_id: product.project_id ?? "",
    build_profile_text: JSON.stringify(
      {
        workdirs: [mount_name],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
        artifact_exclude: [],
        output_name_template: "{{solution}}.zip",
      },
      null,
      2,
    ),
    roots_text: JSON.stringify(
      [
        {
          root_type: "single_repo",
          directory,
          display_name: product.name,
          mount_name,
          sort_order: 0,
          enabled: true,
        },
      ],
      null,
      2,
    ),
  }
}

/** 中文注释：新增方案时只要求名称和编码，兼容归属产品改为内部字段后不再阻塞保存。 */
export function solutionLibrarySubmitDisabled(input: SubmitLike) {
  return input.pending || !input.name.trim() || !input.code.trim()
}

/** 中文注释：在提交前做一层本地校验，把常见配置错误拦在前端而不是等后端报错。 */
export function validateSolutionDraft(build_profile: unknown, roots: unknown) {
  const profile = build_profile as BuildProfileLike | undefined
  if (!profile || typeof profile !== "object") return "编译打包配置必须是 JSON 对象"
  if (!Array.isArray(profile.workdirs) || profile.workdirs.length === 0 || profile.workdirs.some((item) => !item?.trim())) {
    return "请至少配置一个有效的 workdir"
  }
  if (!profile.compile_command?.trim()) return "请先配置 compile_command"
  if (!Array.isArray(roots) || roots.length === 0) return "请至少配置一个源码根目录"
  for (const item of roots as RootLike[]) {
    if (!item?.directory?.trim()) return "源码根目录不能为空"
    if (item.root_type === "virtual_group" && (!Array.isArray(item.meta?.directories) || item.meta.directories.length === 0)) {
      return "虚拟目录组至少需要一个成员目录"
    }
  }
  return ""
}

/** 中文注释：校正方案库当前选中项，避免刷新后落在不存在的方案上。 */
export function syncSolutionLibrarySelection(items: SolutionLike[], current: string) {
  if (items.length === 0) return ""
  if (items.some((item) => item.id === current)) return current
  return items[0]!.id
}

/** 中文注释：统一按名称升序整理解决方案导航，保证管理员定位方案时顺序稳定。 */
export function sortNamedSolutions<T extends { name?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const left = a.name ?? ""
    const right = b.name ?? ""
    const leftBucket = /^[a-z0-9]/i.test(left) ? 0 : 1
    const rightBucket = /^[a-z0-9]/i.test(right) ? 0 : 1
    if (leftBucket !== rightBucket) return leftBucket - rightBucket
    return left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
  })
}

/** 中文注释：按方案名称执行大小写不敏感检索，并复用统一排序结果。 */
export function filterNamedSolutions<T extends { name?: string }>(items: T[], keyword: string) {
  const query = keyword.trim().toLocaleLowerCase()
  const sorted = sortNamedSolutions(items)
  if (!query) return sorted
  return sorted.filter((item) => (item.name ?? "").toLocaleLowerCase().includes(query))
}

/** 中文注释：生成方案库左侧导航项样式，突出当前被查看或编辑的方案。 */
export function solutionLibraryItemClass(selected: boolean) {
  return selected
    ? "border-brand-solid bg-brand-solid/10 text-text-strong shadow-[0_8px_30px_rgba(15,118,110,0.12)]"
    : "border-border-weak-base bg-surface-base hover:bg-surface-panel/60 text-text-weak"
}

/** 中文注释：返回方案库页面的主从布局类名，保证在设置弹窗宽度下即可稳定左右分栏。 */
export function solutionLibraryLayoutClass() {
  return "grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"
}
