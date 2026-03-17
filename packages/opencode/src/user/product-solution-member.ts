import { Filesystem } from "@/util/filesystem"

export type ProductSolutionMember = {
  directory: string
  name: string
  relative_path: string
  solution_id: string
  solution_code: string
}

/** 中文注释：统一生成成员目录的判重键，避免同一路径被多次挂进同一个聚合工作区。 */
function directoryKey(directory: string) {
  return Filesystem.windowsPath(Filesystem.accessPath(directory)).toLowerCase()
}

/** 中文注释：对挂载路径做大小写无关的稳定判重，兼容 Windows 与网络共享路径。 */
function pathKey(input: string) {
  return input.trim().toLowerCase()
}

/** 中文注释：当多个解决方案使用同名挂载目录时，优先追加方案编码生成可读且稳定的唯一路径。 */
function uniquePath(base: string, item: ProductSolutionMember, seen: Set<string>) {
  if (!seen.has(pathKey(base))) return base
  const suffix = item.solution_code.trim() || item.solution_id.slice(-6)
  let next = `${base}-${suffix}`
  let index = 2
  while (seen.has(pathKey(next))) {
    next = `${base}-${suffix}-${index}`
    index += 1
  }
  return next
}

/** 中文注释：统一去重并修正解决方案成员挂载名，避免产品会话和 build 聚合目录发生同名覆盖。 */
export function uniqueSolutionMembers(items: ProductSolutionMember[]) {
  const seenDirectories = new Set<string>()
  const seenPaths = new Set<string>()
  return items.flatMap((item) => {
    const key = directoryKey(item.directory)
    if (seenDirectories.has(key)) return []
    seenDirectories.add(key)
    const base = item.relative_path.trim() || item.name.trim() || item.solution_code.trim() || item.solution_id
    const relative_path = uniquePath(base, item, seenPaths)
    seenPaths.add(pathKey(relative_path))
    return [
      {
        ...item,
        name: relative_path,
        relative_path,
      } satisfies ProductSolutionMember,
    ]
  })
}
