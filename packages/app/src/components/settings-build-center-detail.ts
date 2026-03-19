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
  const lines = Array.isArray(logs)
    ? logs.flatMap((item) => {
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
    : ([] as string[])
  const requested = Array.isArray(input.requested_workdirs) ? input.requested_workdirs.filter((item) => typeof item === "string") : []
  const resolved = Array.isArray(input.resolved_workdirs) ? input.resolved_workdirs.filter((item) => typeof item === "string") : []
  const sourceRoots = Array.isArray(input.source_roots) ? input.source_roots.filter((item) => typeof item === "string") : []
  const warnings = Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : []
  if (typeof input.current_status === "string" && input.current_status.trim()) lines.push(`当前状态: ${input.current_status.trim()}`)
  if (typeof input.current_step === "string" && input.current_step.trim()) lines.push(`当前步骤: ${input.current_step.trim()}`)
  if (typeof input.command === "string" && input.command.trim()) lines.push(`命令: ${input.command.trim()}`)
  if (typeof input.cwd === "string" && input.cwd.trim()) lines.push(`工作目录: ${input.cwd.trim()}`)
  if (requested.length > 0) lines.push(`配置目录: ${requested.join("、")}`)
  if (resolved.length > 0) lines.push(`实际目录: ${resolved.join("、")}`)
  if (sourceRoots.length > 0) lines.push(`源码根: ${sourceRoots.join("、")}`)
  if (typeof input.compile_sandbox_directory === "string" && input.compile_sandbox_directory.trim()) {
    lines.push(`编译沙盒: ${input.compile_sandbox_directory.trim()}`)
  }
  if (typeof input.applied_files_count === "number") lines.push(`变更文件数: ${input.applied_files_count}`)
  if (typeof input.required_platform === "string" && input.required_platform.trim()) {
    lines.push(`要求平台: ${input.required_platform.trim()}`)
  }
  if (typeof input.current_platform === "string" && input.current_platform.trim()) {
    lines.push(`当前平台: ${input.current_platform.trim()}`)
  }
  for (const warning of warnings) lines.push(`提示: ${warning}`)
  return lines
}

/** 中文注释：把打包产物条目转成便于直接渲染的文本列表。 */
function packageLines(input: Record<string, unknown>) {
  const lines = [] as string[]
  if (typeof input.current_status === "string" && input.current_status.trim()) lines.push(`当前状态: ${input.current_status.trim()}`)
  if (typeof input.current_step === "string" && input.current_step.trim()) lines.push(`当前步骤: ${input.current_step.trim()}`)
  if (typeof input.file_name === "string" && input.file_name.trim()) lines.push(`产物: ${input.file_name.trim()}`)
  if (typeof input.size === "number") lines.push(`大小: ${input.size} B`)
  if (typeof input.file_path === "string" && input.file_path.trim()) lines.push(`路径: ${input.file_path.trim()}`)
  if (typeof input.output_directory === "string" && input.output_directory.trim()) lines.push(`输出目录: ${input.output_directory.trim()}`)
  if (typeof input.stage_directory === "string" && input.stage_directory.trim()) lines.push(`暂存目录: ${input.stage_directory.trim()}`)
  const patterns = Array.isArray(input.matched_patterns) ? input.matched_patterns.filter((item) => typeof item === "string") : []
  if (patterns.length > 0) lines.push(`打包匹配: ${patterns.join("、")}`)
  const requested = Array.isArray(input.requested_workdirs) ? input.requested_workdirs.filter((item) => typeof item === "string") : []
  const resolved = Array.isArray(input.resolved_workdirs) ? input.resolved_workdirs.filter((item) => typeof item === "string") : []
  if (requested.length > 0) lines.push(`配置目录: ${requested.join("、")}`)
  if (resolved.length > 0) lines.push(`实际目录: ${resolved.join("、")}`)
  const warnings = Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : []
  for (const warning of warnings) lines.push(`提示: ${warning}`)
  return lines
}

/** 中文注释：把改码阶段运行中的目标挂载信息转成更易读的文本列表。 */
function codingLines(input: Record<string, unknown>) {
  const lines = [] as string[]
  if (typeof input.mount_name === "string" && input.mount_name.trim()) lines.push(`挂载: ${input.mount_name.trim()}`)
  if (typeof input.relative_path === "string" && input.relative_path.trim()) lines.push(`目录: ${input.relative_path.trim()}`)
  if (typeof input.stack === "string" && input.stack.trim()) lines.push(`技术栈: ${input.stack.trim()}`)
  const compileTargets = Array.isArray(input.compile_targets)
    ? input.compile_targets.filter((item) => typeof item === "string" && item.trim())
    : []
  if (compileTargets.length > 0) lines.push(`编译目标: ${compileTargets.join("、")}`)
  const candidates = Array.isArray(input.candidate_files)
    ? input.candidate_files.filter((item) => typeof item === "string" && item.trim())
    : []
  if (candidates.length > 0) lines.push(`优先检查: ${candidates.join("、")}`)
  if (typeof input.source_directory === "string" && input.source_directory.trim()) {
    lines.push(`源码: ${input.source_directory.trim()}`)
  }
  return lines
}

/** 中文注释：把改码阶段实时活动摘要转成便于阅读的文本列表。 */
function codingActivityLines(input: Record<string, unknown>) {
  const lines = [] as string[]
  if (typeof input.current_status === "string" && input.current_status.trim()) {
    lines.push(`当前状态: ${input.current_status.trim()}`)
  }
  if (typeof input.change_count === "number") {
    lines.push(`当前变更数: ${input.change_count}`)
  }
  const recent = Array.isArray(input.recent_activity)
    ? input.recent_activity.filter((item) => item && typeof item === "object")
    : []
  for (const item of recent) {
    const row = item as Record<string, unknown>
    if (typeof row.summary === "string" && row.summary.trim()) {
      lines.push(`最近活动: ${row.summary.trim()}`)
    }
  }
  return lines
}

/** 中文注释：把单个方案级明细对象规整成可展示的分组数据。 */
function solutionGroup(input: Record<string, unknown>) {
  const name =
    (typeof input.solution_code === "string" && input.solution_code.trim()) ||
    (typeof input.solution_id === "string" && input.solution_id.trim()) ||
    "未命名方案"
  const coding = codingLines(input)
  if (coding.length > 0) {
    return {
      name,
      lines: coding,
    } satisfies StageGroup
  }
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

/** 中文注释：把运行中的当前步骤对象单独整理成“当前执行”分组，方便管理员看到后台到底卡在哪一步。 */
function activeGroup(detail: Record<string, unknown>) {
  const group = solutionGroup(detail)
  return {
    name: `${group.name}（当前）`,
    lines: group.lines,
  } satisfies StageGroup
}

/** 中文注释：把阶段 detail_json 中的方案明细整理成分组，供详情面板展示。 */
export function buildStageGroups(stage: BuildStageLike) {
  const changes = stage.detail_json?.changes
  const changeGroups = Array.isArray(changes)
    ? changes.flatMap((item) => {
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
      const sourceLine =
        typeof row.source_file_path === "string" && row.source_file_path.trim() ? `真实源码: ${row.source_file_path.trim()}` : ""
      const overlayLine =
        typeof row.overlay_file_path === "string" && row.overlay_file_path.trim() ? `Overlay: ${row.overlay_file_path.trim()}` : ""
      const lines = [pathLine ? `文件: ${pathLine}` : "", sourceLine, overlayLine, typeLine].filter(Boolean)
      if (lines.length === 0) return []
      return [{ name, lines }] satisfies StageGroup[]
    })
    : []
  const solutions = stage.detail_json?.solutions
  const groups = Array.isArray(solutions)
    ? solutions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        return [solutionGroup(item as Record<string, unknown>)]
      })
    : []
  const active =
    stage.detail_json?.active && typeof stage.detail_json.active === "object"
      ? [activeGroup(stage.detail_json.active as Record<string, unknown>)]
      : []
  const meta = [] as StageGroup[]
  if (stage.stage === "coding") {
    const lines = [] as string[]
    if (typeof stage.detail_json?.session_id === "string" && stage.detail_json.session_id.trim()) {
      lines.push(`会话: ${stage.detail_json.session_id.trim()}`)
    }
    if (typeof stage.detail_json?.overlay_root === "string" && stage.detail_json.overlay_root.trim()) {
      lines.push(`Overlay: ${stage.detail_json.overlay_root.trim()}`)
    }
    if (lines.length > 0) {
      meta.push({
        name: "当前改码会话",
        lines,
      })
    }
    const activity = codingActivityLines(stage.detail_json ?? {})
    if (activity.length > 0) {
      meta.push({
        name: "实时进度",
        lines: activity,
      })
    }
  }
  if (changeGroups.length > 0 || groups.length > 0 || active.length > 0 || meta.length > 0) {
    return [...changeGroups, ...active, ...groups, ...meta]
  }
  return Object.keys(stage.detail_json ?? {}).length === 0
    ? ([] as StageGroup[])
    : [
        {
          name: "阶段信息",
          lines: Object.entries(stage.detail_json ?? {}).flatMap(([key, value]) => {
            if (value === undefined || value === null) return []
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
              return [`${key}: ${value}`]
            }
            return [`${key}: ${JSON.stringify(value)}`]
          }),
        },
      ]
}
