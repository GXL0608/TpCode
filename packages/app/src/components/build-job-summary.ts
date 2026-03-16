type BuildStageDetail = {
  stage?: string
  detail_json?: Record<string, unknown>
}

type BuildArtifactDetail = {
  id?: string
  file_name?: string
}

type BuildSummaryInput = {
  solution_scope?: string
  stages?: BuildStageDetail[]
  artifacts?: BuildArtifactDetail[]
}

/** 中文注释：把构建执行范围翻译成界面可读文案，供管理端和用户态共用。 */
export function buildScopeText(input?: string) {
  if (input === "product_all") return "全产品方案"
  return "单解决方案"
}

/** 中文注释：从单个阶段详情中提取方案编码，兼容编译与打包阶段的明细结构。 */
function detailCodes(input?: Record<string, unknown>) {
  const solutions = input?.solutions
  if (!Array.isArray(solutions)) return [] as string[]
  return solutions.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const code = (item as Record<string, unknown>).solution_code
    return typeof code === "string" && code.trim() ? [code.trim()] : []
  })
}

/** 中文注释：从构建阶段明细中汇总去重后的方案编码列表。 */
export function collectBuildSolutionCodes(stages?: BuildStageDetail[]) {
  const values = (stages ?? []).flatMap((item) => detailCodes(item.detail_json))
  return [...new Set(values)]
}

/** 中文注释：生成构建任务列表摘要，帮助管理员快速判断覆盖范围和产物数量。 */
export function buildSummaryLine(input: BuildSummaryInput) {
  const parts = [buildScopeText(input.solution_scope)]
  const codes = collectBuildSolutionCodes(input.stages)
  if (codes.length > 0) parts.push(codes.join("、"))
  const count = input.artifacts?.length ?? 0
  if (count > 0) parts.push(`${count} 个包`)
  return parts.join(" · ")
}

/** 中文注释：生成用户侧 build 成功提示，让结果说明包含方案范围和产物数量。 */
export function buildToastDescription(input: BuildSummaryInput) {
  const codes = collectBuildSolutionCodes(input.stages)
  const count = input.artifacts?.length ?? 0
  if (codes.length > 0 && count > 0) {
    return `系统已完成 ${codes.join("、")} 的改码、编译与打包，本次共生成 ${count} 个发布包。`
  }
  if (codes.length > 0) {
    return `系统已完成 ${codes.join("、")} 的改码、编译与打包，你可以在会话或构建中心继续查看结果。`
  }
  if (count > 0) {
    return `系统已完成计划、改码、编译与打包，本次共生成 ${count} 个发布包。`
  }
  return "系统已完成计划、改码、编译与打包，你可以在会话或构建中心继续查看结果。"
}
