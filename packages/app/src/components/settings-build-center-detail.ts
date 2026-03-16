type BuildJobLike = {
  id: string
}

type BuildStageLike = {
  stage?: string
  detail_json?: Record<string, unknown>
}

type StageGroup = {
  name: string
  lines: string[]
}

/** 中文注释：校正当前选中的构建任务，列表刷新后优先保留用户已选任务。 */
export function syncBuildCenterJobSelection(items: BuildJobLike[], current: string) {
  if (items.length === 0) return ""
  if (items.some((item) => item.id === current)) return current
  return items[0]!.id
}

/** 中文注释：把内部阶段编码翻译成构建中心详情里的中文标题。 */
export function buildStageLabel(stage: string) {
  if (stage === "plan") return "计划"
  if (stage === "coding") return "改码"
  if (stage === "compile") return "编译"
  if (stage === "package") return "打包"
  return stage
}

/** 中文注释：把方案级日志条目转成便于直接渲染的文本列表。 */
function logLines(input: Record<string, unknown>) {
  const logs = input.logs
  if (!Array.isArray(logs)) return [] as string[]
  return logs.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const head = [
      typeof row.step === "string" ? row.step : undefined,
      typeof row.exit_code === "number" ? `exit ${row.exit_code}` : undefined,
      typeof row.workdir === "string" && row.workdir.trim() ? row.workdir.trim() : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
    const lines = head ? [head] : []
    if (typeof row.stdout === "string" && row.stdout.trim()) lines.push(`stdout: ${row.stdout.trim()}`)
    if (typeof row.stderr === "string" && row.stderr.trim()) lines.push(`stderr: ${row.stderr.trim()}`)
    return lines
  })
}

/** 中文注释：把打包产物条目转成便于直接渲染的文本列表。 */
function packageLines(input: Record<string, unknown>) {
  const lines = [] as string[]
  if (typeof input.file_name === "string" && input.file_name.trim()) lines.push(`产物: ${input.file_name.trim()}`)
  if (typeof input.size === "number") lines.push(`大小: ${input.size} B`)
  if (typeof input.file_path === "string" && input.file_path.trim()) lines.push(`路径: ${input.file_path.trim()}`)
  return lines
}

/** 中文注释：把单个方案级明细对象规整成可展示的分组数据。 */
function solutionGroup(input: Record<string, unknown>) {
  const name =
    (typeof input.solution_code === "string" && input.solution_code.trim()) ||
    (typeof input.solution_id === "string" && input.solution_id.trim()) ||
    "未命名方案"
  const lines = logLines(input)
  if (lines.length > 0) {
    return {
      name,
      lines,
    } satisfies StageGroup
  }
  const packaged = packageLines(input)
  if (packaged.length > 0) {
    return {
      name,
      lines: packaged,
    } satisfies StageGroup
  }
  const fallback = Object.entries(input)
    .filter(([key]) => !["solution_id", "solution_code"].includes(key))
    .flatMap(([key, value]) => {
      if (value === undefined || value === null) return []
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [`${key}: ${value}`]
      return [`${key}: ${JSON.stringify(value)}`]
    })
  return {
    name,
    lines: fallback,
  } satisfies StageGroup
}

/** 中文注释：把阶段 detail_json 中的方案明细整理成分组，供详情面板展示。 */
export function buildStageGroups(stage: BuildStageLike) {
  const changes = stage.detail_json?.changes
  if (Array.isArray(changes)) {
    return changes.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as Record<string, unknown>
      const name =
        (typeof row.solution_code === "string" && row.solution_code.trim()) ||
        (typeof row.mount_name === "string" && row.mount_name.trim()) ||
        "未命名方案"
      const pathLine =
        (typeof row.display_path === "string" && row.display_path.trim()) ||
        (typeof row.relative_path === "string" && row.relative_path.trim()) ||
        ""
      const typeLine = typeof row.change_type === "string" && row.change_type.trim() ? `变更: ${row.change_type}` : ""
      const lines = [pathLine, typeLine].filter(Boolean)
      if (lines.length === 0) return []
      return [{ name, lines }] satisfies StageGroup[]
    })
  }
  const solutions = stage.detail_json?.solutions
  if (!Array.isArray(solutions)) return [] as StageGroup[]
  return solutions.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    return [solutionGroup(item as Record<string, unknown>)]
  })
}
