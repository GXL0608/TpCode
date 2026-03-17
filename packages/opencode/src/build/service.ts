import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { ulid } from "ulid"
import { Archive } from "@/util/archive"
import { BuildProfile, normalizeBuildProfile } from "./profile"
import { Database, and, asc, desc, eq, inArray, or } from "@/storage/db"
import { TpBuildArtifactTable } from "./artifact.sql"
import { TpBuildJobTable } from "./job.sql"
import { TpBuildJobStageTable } from "./job-stage.sql"
import { ProductSolutionService } from "@/user/product-solution"
import { TpProductTable } from "@/user/product.sql"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { Workspace } from "@/control-plane/workspace"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Global } from "@/global"
import { TpSavedPlanTable } from "@/plan/saved-plan.sql"
import { type ProductSolutionItem } from "@/user/product-solution"
import { anchorBySolutions } from "@/user/product-anchor"
import { uniqueSolutionMembers } from "@/user/product-solution-member"
import { BuildOverlay } from "./overlay"
import { BuildCompileSandbox } from "./compile-sandbox"
import { AccountCurrent } from "@/user/current"
import { withTimeout } from "@/util/timeout"

const stages = ["plan", "coding", "compile", "package"] as const
type BuildStage = (typeof stages)[number]

type JobRow = typeof TpBuildJobTable.$inferSelect

type BuildJobItem = {
  id: string
  source_type: string
  source_id?: string
  prompt_text?: string
  product_id: string
  solution_scope: string
  solution_id: string
  runtime_provider_id?: string
  runtime_model_id?: string
  session_id?: string
  workspace_id?: string
  status: string
  current_stage?: string
  plan_content?: string
  started: boolean
  error_code?: string
  error_message?: string
  time_created: number
  time_updated: number
}

type BuildJobStageItem = {
  id: string
  job_id: string
  stage: string
  status: string
  detail_json?: Record<string, unknown>
  error_code?: string
  error_message?: string
  time_created: number
  time_updated: number
}

type JobStageRow = typeof TpBuildJobStageTable.$inferSelect

type BuildArtifactItem = {
  id: string
  job_id: string
  solution_id: string
  file_name: string
  file_path: string
  size: number
  hash: string
  time_created: number
  time_updated: number
}

type BuildJobDetail = {
  job: BuildJobItem
  stages: BuildJobStageItem[]
  artifacts: BuildArtifactItem[]
}

type CodingActivity = {
  summary: string
  time_created?: number
}

/** 中文注释：把会话消息按真实创建时间升序排列，避免倒序流在恢复改码和展示状态时覆盖掉最新结果。 */
async function orderedMessages(session_id: string) {
  const messages = [] as MessageV2.WithParts[]
  for await (const message of MessageV2.stream(session_id)) {
    messages.push(message)
  }
  return messages.sort(
    (a, b) =>
      (a.info.time.created ?? 0) - (b.info.time.created ?? 0) || a.info.id.localeCompare(b.info.id),
  )
}

/** 中文注释：统一把数据库中的 build job 主记录转换为稳定返回结构。 */
function jobItem(row: JobRow): BuildJobItem {
  return {
    id: row.id,
    source_type: row.source_type,
    source_id: row.source_id ?? undefined,
    prompt_text: row.prompt_text ?? undefined,
    product_id: row.product_id,
    solution_scope: row.solution_scope,
    solution_id: row.solution_id,
    runtime_provider_id: row.runtime_provider_id ?? undefined,
    runtime_model_id: row.runtime_model_id ?? undefined,
    session_id: row.session_id ?? undefined,
    workspace_id: row.workspace_id ?? undefined,
    status: row.status,
    current_stage: row.current_stage ?? undefined,
    plan_content: row.plan_content ?? undefined,
    started: row.started,
    error_code: row.error_code ?? undefined,
    error_message: row.error_message ?? undefined,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** 中文注释：统一转换阶段记录，供详情接口和管理端列表直接消费。 */
function stageItem(row: typeof TpBuildJobStageTable.$inferSelect): BuildJobStageItem {
  return {
    id: row.id,
    job_id: row.job_id,
    stage: row.stage,
    status: row.status,
    detail_json: (row.detail_json as Record<string, unknown> | null) ?? undefined,
    error_code: row.error_code ?? undefined,
    error_message: row.error_message ?? undefined,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** 中文注释：统一转换产物记录，避免前后端再处理数据库字段命名差异。 */
function artifactItem(row: typeof TpBuildArtifactTable.$inferSelect): BuildArtifactItem {
  return {
    id: row.id,
    job_id: row.job_id,
    solution_id: row.solution_id,
    file_name: row.file_name,
    file_path: row.file_path,
    size: row.size,
    hash: row.hash,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

type ShellResult = {
  exitCode: number
  stdout: string
  stderr: string
  timed_out: boolean
}

/** 中文注释：跨平台执行编译或安装命令，并在超时后主动终止子进程，避免 build job 无限挂起。 */
async function shell(command: string, cwd: string, timeout_ms: number): Promise<ShellResult> {
  const cmd =
    process.platform === "win32"
      ? ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
      : ["sh", "-lc", command]
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(proc.stdout).text().catch(() => "")
  const stderr = new Response(proc.stderr).text().catch(() => "")
  let timed_out = false
  const timer = setTimeout(() => {
    timed_out = true
    proc.kill()
  }, timeout_ms)
  const exitCode = await proc.exited.catch(() => 1)
  clearTimeout(timer)
  const [out, err] = await Promise.all([stdout, stderr])
  return {
    exitCode,
    stdout: out.trim(),
    stderr: err.trim(),
    timed_out,
  }
}

/** 中文注释：从 AI 回复中抽取最后一段文本，作为 build job 的计划快照。 */
function assistantText(input: Awaited<ReturnType<typeof SessionPrompt.prompt>>) {
  const part = input.parts.filter((item) => item.type === "text").at(-1)
  return part?.text?.trim() || undefined
}

/** 中文注释：按模板生成压缩包名称，当前支持 solution 与 job 两个占位符。 */
function outputName(template: string, input: { solution: string; job: string }) {
  return template
    .replaceAll("{{solution}}", input.solution)
    .replaceAll("{{job}}", input.job)
}

/** 中文注释：把毫秒超时值格式化成对用户更友好的中文秒数描述，至少显示 1 秒。 */
function timeoutText(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  return `${seconds} 秒`
}

/** 中文注释：读取构建改码阶段的超时时间，避免模型或工具异常时构建任务无限卡在 running。 */
function codingTimeout() {
  const value = Number(process.env.TPCODE_BUILD_CODING_TIMEOUT_MS ?? "180000")
  if (!Number.isFinite(value) || value <= 0) return 180000
  return value
}

/** 中文注释：读取编译沙盒准备阶段的超时时间，避免共享盘或 worktree 操作把任务长期卡死。 */
function compilePrepareTimeout() {
  const value = Number(process.env.TPCODE_BUILD_COMPILE_PREP_TIMEOUT_MS ?? "300000")
  if (!Number.isFinite(value) || value <= 0) return 300000
  return value
}

/** 中文注释：读取编译与安装命令的超时时间，超时后主动终止子进程并回写友好错误。 */
function compileCommandTimeout() {
  const value = Number(process.env.TPCODE_BUILD_COMPILE_COMMAND_TIMEOUT_MS ?? "900000")
  if (!Number.isFinite(value) || value <= 0) return 900000
  return value
}

/** 中文注释：读取打包阶段的超时时间，避免压缩或产物收集异常时任务无限挂起。 */
function packageTimeout() {
  const value = Number(process.env.TPCODE_BUILD_PACKAGE_TIMEOUT_MS ?? "300000")
  if (!Number.isFinite(value) || value <= 0) return 300000
  return value
}

/** 中文注释：把构建会话中的最近消息整理成用户可读的活动摘要，供构建中心实时展示。 */
function activity(input: { message: MessageV2.WithParts }) {
  const lines = [] as string[]
  for (const part of input.message.parts) {
    if (part.type === "tool") {
      const status = part.state?.status === "completed" ? "完成" : part.state?.status === "error" ? "失败" : "执行中"
      lines.push(`工具 ${part.tool} ${status}`)
      continue
    }
    if (part.type === "patch") {
      const files = part.files?.flatMap((item) => item.file ? [item.file] : [])
      lines.push(files && files.length > 0 ? `已生成补丁：${files.join("、")}` : "已生成补丁")
      continue
    }
    if (part.type === "reasoning" && part.text?.trim()) {
      lines.push(`思考：${part.text.trim().split("\n")[0]}`)
      continue
    }
    if (part.type === "text" && part.text?.trim()) {
      lines.push(`回复：${part.text.trim().split("\n")[0]}`)
      continue
    }
  }
  if (lines.length === 0 && input.message.info.role === "assistant") {
    lines.push("模型正在继续处理当前改码步骤")
  }
  return {
    summary: lines.join("；"),
    time_created: input.message.info.time.completed ?? input.message.info.time.created,
  } satisfies CodingActivity
}

/** 中文注释：读取构建会话最近的活动摘要和当前 overlay 变更，避免前端依赖 session 接口跨产品读取。 */
async function codingSnapshot(input: { session_id?: string; stage?: BuildJobStageItem }) {
  const session_id = input.session_id?.trim()
  if (!session_id) return
  const overlay = await BuildOverlay.load(session_id).catch(() => undefined)
  const changes = overlay ? await BuildOverlay.listChanges(overlay).catch(() => []) : []
  const messages = (await orderedMessages(session_id)).slice(-8)
  const recent_activity = messages
    .filter((message) => message.info.role === "assistant")
    .slice(-4)
    .map((message) => ({
      message_id: message.info.id,
      ...activity({ message }),
    }))
    .filter((item) => item.summary.trim())
  const current = messages[messages.length - 1]
  const current_status =
    current?.info.role === "assistant" && current.parts.length === 0
      ? "模型正在生成下一步改码动作"
      : recent_activity[recent_activity.length - 1]?.summary
  return {
    ...(input.stage?.detail_json ?? {}),
    current_status,
    recent_activity,
    change_count: changes.length,
    changes,
  } satisfies Record<string, unknown>
}

/** 中文注释：当 overlay manifest 暂时未刷出时，从会话中的 patch/edit 记录补偿恢复真实改动文件。 */
async function recoverCodingChanges(input: { overlay: BuildOverlay.Info; session_id: string }) {
  const existing = await BuildOverlay.listChanges(input.overlay).catch(() => [] as BuildOverlay.Change[])
  if (existing.length > 0) return existing
  const files = [] as string[]
  const replay = new Map<string, { kind: "write" | "delete"; content?: string }>()
  for (const message of await orderedMessages(input.session_id)) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type === "patch") {
        files.push(...part.files)
        continue
      }
      if (part.type !== "tool") continue
      if (part.state?.status !== "completed") continue
      const filePath = typeof part.state?.input?.filePath === "string" ? part.state.input.filePath : undefined
      if (part.tool === "edit") {
        if (!filePath) continue
        files.push(filePath)
        const after = typeof part.state.metadata?.filediff?.after === "string" ? part.state.metadata.filediff.after : undefined
        if (after === undefined) continue
        replay.set(filePath, {
          kind: "write",
          content: after,
        })
        continue
      }
      if (part.tool === "write") {
        if (!filePath) continue
        files.push(filePath)
        const content = typeof part.state.input?.content === "string" ? part.state.input.content : undefined
        if (content === undefined) continue
        replay.set(filePath, {
          kind: "write",
          content,
        })
        continue
      }
      if (part.tool !== "apply_patch") continue
      const patched = Array.isArray(part.state.metadata?.files) ? part.state.metadata.files : []
      for (const item of patched) {
        const target =
          typeof item?.movePath === "string"
            ? item.movePath
            : typeof item?.filePath === "string"
              ? item.filePath
              : undefined
        if (!target) continue
        files.push(target)
        if (item?.type === "delete") {
          replay.set(target, {
            kind: "delete",
          })
          continue
        }
        const after = typeof item?.after === "string" ? item.after : undefined
        if (after === undefined) continue
        replay.set(target, {
          kind: "write",
          content: after,
        })
      }
    }
  }
  for (const [filePath, item] of replay) {
    const target = BuildOverlay.remapSourcePath({
      overlay: input.overlay,
      filePath,
    })
    if (item.kind === "delete") {
      await BuildOverlay.deletePath({
        overlay: input.overlay,
        filePath: target,
      }).catch(() => undefined)
      continue
    }
    if (item.content === undefined) continue
    await BuildOverlay.writeText({
      overlay: input.overlay,
      filePath: target,
      content: item.content,
    }).catch(() => undefined)
  }
  if (files.length === 0 && replay.size === 0) return existing
  const restored = await BuildOverlay.recordPaths({
    overlay: input.overlay,
    files: [...files, ...replay.keys()],
  }).catch(() => [] as BuildOverlay.Change[])
  const recovered = await BuildOverlay.listChanges(input.overlay).catch(() => [] as BuildOverlay.Change[])
  if (recovered.length > 0) return recovered
  return restored
}

/** 中文注释：改码超时后做短暂重试，尽量把刚落盘但尚未被状态流感知的真实改动稳定恢复出来。 */
async function recoverTimedOutCoding(input: {
  overlay: BuildOverlay.Info
  session_id: string
  stage: BuildJobStageItem
  attempts?: number
  delay_ms?: number
}) {
  let snapshot = await codingSnapshot({
    session_id: input.session_id,
    stage: input.stage,
  })
  let changes = [] as BuildOverlay.Change[]
  for (const attempt of Array.from({ length: input.attempts ?? 6 }, (_, index) => index)) {
    if (attempt > 0) await Bun.sleep(input.delay_ms ?? 50)
    const recovered = await recoverCodingChanges({
      overlay: input.overlay,
      session_id: input.session_id,
    }).catch(() => [] as BuildOverlay.Change[])
    snapshot = await codingSnapshot({
      session_id: input.session_id,
      stage: input.stage,
    })
    const snapshot_changes = Array.isArray(snapshot?.changes) ? (snapshot.changes as BuildOverlay.Change[]) : []
    changes = recovered.length >= snapshot_changes.length ? recovered : snapshot_changes
    if (changes.length > 0) {
      return {
        changes,
        snapshot,
      }
    }
  }
  return {
    changes,
    snapshot,
  }
}

/** 中文注释：为解决方案 roots 收集显式批量成员，兼容单仓、父目录扫描和虚拟目录组。 */
async function members(solution: ProductSolutionItem) {
  const list = [] as Array<{
    directory: string
    name: string
    relative_path: string
    solution_id: string
    solution_code: string
  }>
  for (const root of solution.roots.filter((item) => item.enabled)) {
    if (root.root_type === "single_repo") {
      const name = root.mount_name?.trim() || root.display_name?.trim() || Filesystem.baseName(root.directory)
      list.push({
        directory: Filesystem.accessPath(root.directory),
        name,
        relative_path: name,
        solution_id: solution.id,
        solution_code: solution.code,
      })
      continue
    }
    if (root.root_type === "parent_batch") {
      const sourceRoot = Filesystem.accessPath(root.directory)
      const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => [])
      const children = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const directory = path.join(sourceRoot, entry.name)
            if (!(await Filesystem.exists(path.join(directory, ".git")))) return
            return {
              directory,
              name: entry.name,
              relative_path: entry.name,
              solution_id: solution.id,
              solution_code: solution.code,
            }
          }),
      )
      list.push(...children.filter((item): item is NonNullable<typeof item> => Boolean(item)))
      continue
    }
    const directories = root.meta?.directories ?? []
    for (const [index, directory] of directories.entries()) {
      const source = Filesystem.accessPath(directory)
      const name =
        root.mount_name?.trim() && directories.length === 1
          ? root.mount_name.trim()
          : Filesystem.baseName(directory) || `${root.display_name?.trim() || "member"}-${index + 1}`
      list.push({
        directory: source,
        name,
        relative_path: name,
        solution_id: solution.id,
        solution_code: solution.code,
      })
    }
  }
  return uniqueSolutionMembers(list)
}

/** 中文注释：把多个解决方案的成员目录合并去重，供产品级 build 在同一沙盒中统一改码。 */
async function productMembers(solutions: ProductSolutionItem[]) {
  const rows = uniqueSolutionMembers((await Promise.all(solutions.map((item) => members(item)))).flat())
  const seen = new Set<string>()
  return rows.filter((item) => {
    const key = Filesystem.windowsPath(Filesystem.accessPath(item.directory)).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type CodingHint = {
  solution_id: string
  solution_code: string
  mount_name: string
  source_directory: string
  stack: string
  compile_targets: string[]
  candidate_files: string[]
}

/** 中文注释：从编译命令中提取解决方案或项目文件路径，供编码提示和详情展示复用。 */
function compileTargets(command: string) {
  const values = [...command.matchAll(/['"]([^'"]+\.(?:sln|csproj|vbproj|fsproj|props|targets))['"]/gi)]
    .map((item) => item[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .map((item) =>
      item
        .replaceAll("\\", "/")
        .replace(/\/+/g, "/")
        .replace(/^[.]\//, "")
        .replace(/^\/+/, ""),
    )
  return [...new Set(values)]
}

/** 中文注释：按编译命令的特征推断技术栈，帮助模型更快选择正确的搜索策略。 */
function stack(profile: ReturnType<typeof normalizeBuildProfile>) {
  const command = profile.compile_command.toLowerCase()
  if (command.includes(".csproj") || command.includes(".sln") || command.includes("msbuild") || command.includes("dotnet")) {
    return ".NET/C#"
  }
  if (command.includes("mvn") || command.includes("gradle") || command.includes("pom.xml")) return "Java"
  if (command.includes("package.json") || command.includes("pnpm") || command.includes("npm ") || command.includes("vite")) {
    return "Node/Web"
  }
  return "通用项目"
}

/** 中文注释：针对“登录页”等高频需求预扫候选文件，避免模型在大型代码库里长时间盲搜。 */
async function candidates(input: {
  text: string
  members: Awaited<ReturnType<typeof productMembers>>
}) {
  const query = input.text.toLowerCase()
  if (!/(登录|login)/i.test(query)) return [] as string[]
  const patterns = [
    "**/frmLogin*.cs",
    "**/*Login*.cs",
    "**/*login*.cs",
    "**/*Login*.Designer.cs",
    "**/*login*.Designer.cs",
    "**/*Login*.aspx",
    "**/*login*.aspx",
  ]
  const rows = [] as string[]
  for (const member of input.members) {
    for (const pattern of patterns) {
      const matches = await Glob.scan(pattern, {
        cwd: member.directory,
        absolute: false,
        include: "file",
      })
      for (const match of matches) {
        rows.push(path.posix.join(member.relative_path, match.replaceAll(path.sep, "/")))
        if (rows.length >= 8) return [...new Set(rows)]
      }
    }
  }
  return [...new Set(rows)]
}

/** 中文注释：把解决方案的技术栈、编译入口和候选文件整理成编码提示，降低真实项目中的盲搜开销。 */
async function codingHints(input: {
  text: string
  solutions: ProductSolutionItem[]
  members: Awaited<ReturnType<typeof productMembers>>
}) {
  return Promise.all(input.solutions.map(async (solution) => {
    const profile = normalizeBuildProfile(solution.build_profile)
    const mounts = input.members.filter((item) => item.solution_id === solution.id)
    const mount_name = mounts[0]?.relative_path ?? solution.code
    return {
      solution_id: solution.id,
      solution_code: solution.code,
      mount_name,
      source_directory: mounts[0]?.directory ?? "",
      stack: stack(profile),
      compile_targets: compileTargets(profile.compile_command),
      candidate_files: await candidates({
        text: input.text,
        members: mounts,
      }),
    } satisfies CodingHint
  }))
}

/** 中文注释：识别默认占位编译命令，防止管理员尚未配置真实编译命令时被误判为编译成功。 */
function placeholder(command: string) {
  return /^echo\s+(['"])?build\1$/i.test(command.trim())
}

/** 中文注释：识别只适用于 Windows PowerShell/MSBuild 的编译脚本，非 Windows 节点需要提前给出友好错误。 */
function windowsOnly(command: string) {
  if (/msbuild(?:\.exe)?/i.test(command)) return true
  if (/(?:^|[;\s])(New-Item|Copy-Item|Remove-Item)\b/i.test(command)) return true
  if (/\$[A-Za-z_][A-Za-z0-9_]*\s*=/.test(command)) return true
  return /(?:^|[;\s])&\s*\$[A-Za-z_][A-Za-z0-9_]*/.test(command)
}

/** 中文注释：对已在执行中的 saved plan 构建任务做去重，避免同一计划在构建中心被重复创建。 */
async function activeSavedPlanJob(input: {
  product_id: string
  source_id: string
  solution_scope: string
  solution_id: string
}) {
  return Database.use((db) =>
    db
      .select()
      .from(TpBuildJobTable)
      .where(
        and(
          eq(TpBuildJobTable.source_type, "saved_plan"),
          eq(TpBuildJobTable.product_id, input.product_id),
          eq(TpBuildJobTable.source_id, input.source_id),
          eq(TpBuildJobTable.solution_scope, input.solution_scope),
          eq(TpBuildJobTable.solution_id, input.solution_id),
          inArray(TpBuildJobTable.status, ["pending", "running"]),
        ),
      )
      .orderBy(desc(TpBuildJobTable.time_created))
      .get(),
  )
}

/** 中文注释：当当前账号只有产品上下文时，临时补齐锚点项目上下文，确保 build 期间创建 session 不会被权限链误拦截。 */
function withAnchorProjectContext<R>(project_id: string, fn: () => Promise<R>) {
  const actor = AccountCurrent.optional()
  if (!actor) return fn()
  if (actor.context_project_id) return fn()
  return AccountCurrent.provide(
    {
      ...actor,
      context_project_id: project_id,
    },
    fn,
  )
}

/** 中文注释：把解决方案配置的 workdir 解析为沙盒内真实目录，不存在时直接返回明确错误。 */
async function workdirs(input: {
  workspaceDirectory: string
  workdirs: string[]
  mounts?: string[]
}) {
  const items = [] as Array<{ workdir: string; cwd: string }>
  const missing = [] as string[]
  for (const workdir of input.workdirs.map((item) => item.trim()).filter(Boolean)) {
    const cwd = path.join(input.workspaceDirectory, workdir)
    if (!(await Filesystem.isDir(cwd))) {
      missing.push(workdir)
      continue
    }
    items.push({ workdir, cwd })
  }
  if (missing.length === 0 && items.length > 0) {
    return {
      ok: true as const,
      items,
      warnings: [] as string[],
      requested: input.workdirs,
      resolved: items.map((item) => item.workdir),
    }
  }
  const mounts = [...new Set((input.mounts ?? []).map((item) => item.trim()).filter(Boolean))]
  if (items.length === 0 && mounts.length === 1) {
    const fallback = mounts[0]!
    const cwd = path.join(input.workspaceDirectory, fallback)
    if (await Filesystem.isDir(cwd)) {
      return {
        ok: true as const,
        items: [{ workdir: fallback, cwd }],
        warnings: [`配置的 workdir 不存在，已自动回退到唯一挂载目录 ${fallback}`],
        requested: input.workdirs,
        resolved: [fallback],
      }
    }
  }
  if (missing.length > 0 || items.length === 0) {
    return {
      ok: false as const,
      code: "build_workdir_missing" as const,
      missing: missing.length > 0 ? missing : input.workdirs,
    }
  }
  return {
    ok: true as const,
    items,
    warnings: [] as string[],
    requested: input.workdirs,
    resolved: items.map((item) => item.workdir),
  }
}

/** 中文注释：返回本次 job 实际应执行的解决方案集合，兼容单方案与整产品全方案两种模式。 */
async function runSolutions(job: JobRow) {
  if (job.solution_scope === "product_all") {
    const rows = await ProductSolutionService.list(job.product_id)
    return rows.filter((item) => item.enabled)
  }
  const item = await ProductSolutionService.get(job.solution_id)
  return item ? [item] : []
}

/** 中文注释：根据本次改码实际变更，筛出真正需要进入编译和打包的解决方案，避免未改动方案无意义地耗时编译。 */
function changedCompileTargets(input: { solutions: ProductSolutionItem[]; changes: BuildOverlay.Change[] }) {
  const ids = new Set(input.changes.map((item) => item.solution_id).filter(Boolean))
  if (ids.size === 0) return { items: input.solutions, skipped: [] as Array<Record<string, unknown>> }
  const items = input.solutions.filter((item) => ids.has(item.id))
  if (items.length === 0) return { items: input.solutions, skipped: [] as Array<Record<string, unknown>> }
  return {
    items,
    skipped: input.solutions
      .filter((item) => !ids.has(item.id))
      .map((item) => ({
        solution_id: item.id,
        solution_code: item.code,
        status: "skipped",
        reason: "solution_unchanged",
        message: "本次改码未涉及该解决方案，已跳过编译与打包。",
      })),
  }
}

/** 中文注释：把匹配到的编译产物复制到 staging 目录，便于后续统一压缩打包。 */
async function stageArtifacts(input: {
  workspaceDirectory: string
  stageDirectory: string
  workdirs: string[]
  build_profile: ReturnType<typeof normalizeBuildProfile>
}) {
  const files = new Set<string>()
  const include = input.build_profile.artifact_include.length > 0 ? input.build_profile.artifact_include : ["**/*"]
  for (const workdir of input.workdirs) {
    const cwd = path.join(input.workspaceDirectory, workdir)
    for (const pattern of include) {
      const matches = await Glob.scan(pattern, {
        cwd,
        absolute: true,
        include: "file",
        dot: true,
      })
      for (const item of matches) files.add(item)
    }
  }
  const warnings = [] as string[]
  const matched_patterns = [...include]
  if (files.size === 0) {
    for (const workdir of input.workdirs) {
      const cwd = path.join(input.workspaceDirectory, workdir)
      const matches = await Glob.scan(".ai__build/**/*", {
        cwd,
        absolute: true,
        include: "file",
        dot: true,
      })
      for (const item of matches) files.add(item)
    }
    if (files.size > 0) {
      matched_patterns.splice(0, matched_patterns.length, ".ai__build/**/*")
      warnings.push("配置的 artifact_include 未匹配到产物，已自动回退到 .ai__build 目录")
    }
  }
  const excluded = [...files].filter((item) => {
    const relative = path.relative(input.workspaceDirectory, item)
    return input.build_profile.artifact_exclude.some((pattern) => Glob.match(pattern, relative))
  })
  for (const item of excluded) files.delete(item)
  if (files.size === 0) {
    return { ok: false as const, code: "build_artifact_missing" as const }
  }
  await fs.rm(input.stageDirectory, { recursive: true, force: true }).catch(() => undefined)
  for (const item of files) {
    const relative = path.relative(input.workspaceDirectory, item)
    const target = path.join(input.stageDirectory, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(item, target)
  }
  return { ok: true as const, files: [...files], warnings, matched_patterns }
}

/** 中文注释：创建或更新单个阶段记录，保证同一 job 每个阶段只有一条最新主记录。 */
async function markStage(input: {
  job_id: string
  stage: BuildStage
  status: string
  detail_json?: Record<string, unknown>
  error_code?: string
  error_message?: string
}) {
  const now = Date.now()
  const row = await Database.use((db) =>
    db
      .select()
      .from(TpBuildJobStageTable)
      .where(and(eq(TpBuildJobStageTable.job_id, input.job_id), eq(TpBuildJobStageTable.stage, input.stage)))
      .get(),
  )
  if (!row) {
    await Database.use((db) =>
      db
        .insert(TpBuildJobStageTable)
        .values({
          id: ulid(),
          job_id: input.job_id,
          stage: input.stage,
          status: input.status,
          detail_json: input.detail_json,
          error_code: input.error_code,
          error_message: input.error_message,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    return
  }
  await Database.use((db) =>
    db
      .update(TpBuildJobStageTable)
      .set({
        status: input.status,
        detail_json: input.detail_json,
        error_code: input.error_code,
        error_message: input.error_message,
        time_updated: now,
      })
      .where(eq(TpBuildJobStageTable.id, row.id))
      .run(),
  )
}

/** 中文注释：读取指定任务的单个阶段原始记录，供卡住任务的恢复判断复用。 */
async function stageRow(input: { job_id: string; stage: BuildStage }) {
  return Database.use((db) =>
    db
      .select()
      .from(TpBuildJobStageTable)
      .where(and(eq(TpBuildJobStageTable.job_id, input.job_id), eq(TpBuildJobStageTable.stage, input.stage)))
      .get(),
  )
}

/** 中文注释：判断 coding 阶段是否已经超过预期超时时间且长时间无心跳，避免构建中心出现永久 running。 */
async function staleCoding(input: { job: JobRow; timeout_ms: number; grace_ms?: number }) {
  if (input.job.status !== "running" || input.job.current_stage !== "coding" || !input.job.started) return
  const stage = await stageRow({
    job_id: input.job.id,
    stage: "coding",
  })
  if (!stage) return
  const stale_after = input.timeout_ms + (input.grace_ms ?? 5000)
  const heartbeat = Math.max(stage.time_updated, input.job.time_updated)
  if (Date.now() - heartbeat <= stale_after) return
  return stage
}

/** 中文注释：统一回写 job 当前状态和当前阶段，供列表页轮询时直接读取。 */
async function updateJob(input: {
  job_id: string
  status?: string
  current_stage?: string | null
  session_id?: string | null
  workspace_id?: string | null
  plan_content?: string | null
  error_code?: string | null
  error_message?: string | null
  started?: boolean
}) {
  await Database.use((db) =>
    db
      .update(TpBuildJobTable)
      .set({
        status: input.status,
        current_stage: input.current_stage ?? null,
        session_id: input.session_id ?? undefined,
        workspace_id: input.workspace_id ?? undefined,
        plan_content: input.plan_content ?? undefined,
        error_code: input.error_code ?? undefined,
        error_message: input.error_message ?? undefined,
        started: input.started,
        time_updated: Date.now(),
      })
      .where(eq(TpBuildJobTable.id, input.job_id))
      .run(),
  )
}

/** 中文注释：统一回写编译阶段运行中的详细状态，让构建中心在后台执行时也能看到当前卡在哪一步。 */
async function markCompileRunning(input: {
  job_id: string
  solutions: Array<Record<string, unknown>>
  active: Record<string, unknown>
}) {
  await markStage({
    job_id: input.job_id,
    stage: "compile",
    status: "running",
    detail_json: {
      solutions: input.solutions,
      active: input.active,
    },
  })
  await updateJob({
    job_id: input.job_id,
    current_stage: "compile",
  })
}

/** 中文注释：统一回写打包阶段运行中的详细状态，让前端明确知道当前正在收集哪个方案的产物。 */
async function markPackageRunning(input: {
  job_id: string
  solutions: Array<Record<string, unknown>>
  active: Record<string, unknown>
}) {
  await markStage({
    job_id: input.job_id,
    stage: "package",
    status: "running",
    detail_json: {
      solutions: input.solutions,
      active: input.active,
    },
  })
  await updateJob({
    job_id: input.job_id,
    current_stage: "package",
  })
}

/** 中文注释：统一读取 build job 详情，供服务内部复用和接口层直接输出。 */
async function detail(job_id: string) {
  const row = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job_id)).get())
  if (!row) return
  const [stage_rows, artifact_rows] = await Promise.all([
    Database.use((db) =>
      db.select().from(TpBuildJobStageTable).where(eq(TpBuildJobStageTable.job_id, job_id)).orderBy(asc(TpBuildJobStageTable.time_created)).all(),
    ),
    Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job_id)).orderBy(asc(TpBuildArtifactTable.time_created)).all(),
    ),
  ])
  const stages = stage_rows.map(stageItem)
  const live = row.current_stage === "coding" && row.status === "running"
    ? await codingSnapshot({
        session_id: row.session_id ?? undefined,
        stage: stages.find((item) => item.stage === "coding"),
      })
    : undefined
  return {
    job: jobItem(row),
    stages: stages.map((item) =>
      item.stage === "coding" && live
        ? {
            ...item,
            detail_json: live,
          }
        : item,
    ),
    artifacts: artifact_rows.map(artifactItem),
  } satisfies BuildJobDetail
}

/** 中文注释：统一回收 compile sandbox，保证无论成功失败都不会残留完整临时工作副本。 */
async function cleanupCompileSandboxes(items: Array<{ workspace_id: string }>) {
  for (const item of items) {
    await BuildCompileSandbox.remove(item.workspace_id)
  }
}

export namespace BuildJobService {
  export async function create(input: {
    source_type: "prompt" | "saved_plan"
    product_id: string
    solution_id?: string
    prompt_text?: string
    saved_plan_id?: string
    runtime_model?: {
      providerID: string
      modelID: string
    }
  }) {
    const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, input.product_id)).get())
    if (!product) return { ok: false as const, code: "product_missing" as const }
    const solution_scope = input.solution_id?.trim() ? "single" : "product_all"
    const solution = await ProductSolutionService.resolve({
      product_id: input.product_id,
      solution_id: input.solution_id,
    })
    if (!solution) return { ok: false as const, code: "solution_missing" as const }
    const source_id = input.source_type === "saved_plan" ? input.saved_plan_id?.trim() : undefined
    const prompt_text = input.prompt_text?.trim()
    let plan_content = ""
    if (input.source_type === "prompt") {
      if (!prompt_text) return { ok: false as const, code: "prompt_text_missing" as const }
      plan_content = prompt_text
    }
    if (input.source_type === "saved_plan") {
      if (!source_id) return { ok: false as const, code: "saved_plan_missing" as const }
      const saved = await Database.use((db) => db.select().from(TpSavedPlanTable).where(eq(TpSavedPlanTable.id, source_id)).get())
      if (!saved) return { ok: false as const, code: "saved_plan_missing" as const }
      plan_content = saved.plan_content
    }
    const active =
      input.source_type === "saved_plan" && source_id
        ? await activeSavedPlanJob({
            product_id: input.product_id,
            source_id,
            solution_scope,
            solution_id: solution.id,
          })
        : undefined
    if (active) {
      const reused = await detail(active.id)
      if (reused) return { ok: true as const, job: reused.job, reused: true as const }
    }
    const now = Date.now()
    const id = ulid()
    await Database.use((db) =>
      db
        .insert(TpBuildJobTable)
        .values({
          id,
          source_type: input.source_type,
          source_id,
          prompt_text,
          product_id: input.product_id,
          solution_scope,
          solution_id: solution.id,
          runtime_provider_id: input.runtime_model?.providerID,
          runtime_model_id: input.runtime_model?.modelID,
          status: "pending",
          current_stage: null,
          plan_content,
          started: false,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    const next = await detail(id)
    if (!next) return { ok: false as const, code: "build_job_missing" as const }
    return { ok: true as const, job: next.job, reused: false as const }
  }

  export async function createBatch(input: {
    product_id: string
    solution_id?: string
    saved_plan_ids: string[]
    runtime_model?: {
      providerID: string
      modelID: string
    }
  }) {
    const jobs = [] as BuildJobItem[]
    let created_count = 0
    let reused_count = 0
    for (const saved_plan_id of input.saved_plan_ids) {
      const created = await create({
        source_type: "saved_plan",
        product_id: input.product_id,
        solution_id: input.solution_id,
        saved_plan_id,
        runtime_model: input.runtime_model,
      })
      if (!created.ok) return created
      jobs.push(created.job)
      if (created.reused) reused_count += 1
      if (!created.reused) created_count += 1
    }
    return { ok: true as const, jobs, created_count, reused_count }
  }

  export async function list(input?: {
    product_id?: string
    solution_id?: string
    status?: string
    limit?: number
  }) {
    const rows = await Database.use((db) => {
      const limit = input?.limit ?? 100
      if (!input?.product_id && !input?.solution_id && !input?.status) {
        return db.select().from(TpBuildJobTable).orderBy(desc(TpBuildJobTable.time_created)).limit(limit).all()
      }
      const conditions = [] as Array<ReturnType<typeof eq> | ReturnType<typeof or>>
      if (input.product_id) conditions.push(eq(TpBuildJobTable.product_id, input.product_id))
      if (input.solution_id) {
        conditions.push(
          input.product_id
            ? or(eq(TpBuildJobTable.solution_id, input.solution_id), eq(TpBuildJobTable.solution_scope, "product_all"))
            : eq(TpBuildJobTable.solution_id, input.solution_id),
        )
      }
      if (input.status) conditions.push(eq(TpBuildJobTable.status, input.status))
      return db
        .select()
        .from(TpBuildJobTable)
        .where(and(...conditions))
        .orderBy(desc(TpBuildJobTable.time_created))
        .limit(limit)
        .all()
    })
    void Promise.all(
      rows.map(async (row) => {
        if (!(await staleCoding({ job: row, timeout_ms: codingTimeout() }))) return
        await run(row.id, { coding_timeout_ms: codingTimeout() }).catch(() => undefined)
      }),
    ).catch(() => undefined)
    return rows.map(jobItem)
  }

  export async function get(job_id: string) {
    const row = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job_id)).get())
    if (row && (await staleCoding({ job: row, timeout_ms: codingTimeout() }))) {
      void run(job_id, { coding_timeout_ms: codingTimeout() }).catch(() => undefined)
    }
    return detail(job_id)
  }

  export async function artifact(artifact_id: string) {
    const row = await Database.use((db) => db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.id, artifact_id)).get())
    if (!row) return
    return artifactItem(row)
  }

  /** 中文注释：执行单条 build job，按计划、编码、编译、打包四阶段串行推进。 */
  export async function run(
    job_id: string,
    options?: {
      coding_timeout_ms?: number
      compile_prepare_timeout_ms?: number
      compile_command_timeout_ms?: number
      package_timeout_ms?: number
    },
  ) {
    const job = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job_id)).get())
    if (!job) return { ok: false as const, code: "build_job_missing" as const }
    const timeout_ms = options?.coding_timeout_ms ?? codingTimeout()
    const compile_prepare_timeout_ms = options?.compile_prepare_timeout_ms ?? compilePrepareTimeout()
    const compile_command_timeout_ms = options?.compile_command_timeout_ms ?? compileCommandTimeout()
    const package_timeout_ms = options?.package_timeout_ms ?? packageTimeout()
    if (job.status === "completed") return { ok: true as const, detail: await detail(job_id) }
    const stale_stage = await staleCoding({
      job,
      timeout_ms,
    })
    if (job.started && job.status === "running" && !stale_stage) {
      return { ok: false as const, code: "build_job_running" as const }
    }

    const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, job.product_id)).get())
    if (!product) return { ok: false as const, code: "product_missing" as const }
    const solutions = await runSolutions(job)
    if (solutions.length === 0) return { ok: false as const, code: "solution_missing" as const }
    const primary = solutions[0]
    if (!primary) return { ok: false as const, code: "solution_missing" as const }
    const member_rows = await productMembers(solutions)
    if (member_rows.length === 0) return { ok: false as const, code: "solution_root_missing" as const }

    await updateJob({
      job_id,
      status: "running",
      started: true,
    })
    const compile_sandboxes = [] as Array<{
      workspace_id: string
      workspace_directory: string
      solution: ProductSolutionItem
      profile: ReturnType<typeof normalizeBuildProfile>
    }>

    try {
      const anchor = (await anchorBySolutions(solutions)) ??
        (product.project_id
          ? {
              project_id: product.project_id,
              worktree: undefined,
              vcs: undefined,
            }
          : undefined)
      if (!anchor?.project_id) return { ok: false as const, code: "solution_project_missing" as const }
      const project = await Project.get(anchor.project_id)
      if (!project) return { ok: false as const, code: "project_missing" as const }

      const coding = stale_stage
        ? await withAnchorProjectContext(project.id, async () => {
            if (!job.session_id || !job.workspace_id) {
              await markStage({
                job_id,
                stage: "coding",
                status: "failed",
                error_code: "coding_resume_missing_context",
                error_message: "自动恢复改码任务失败：缺少会话或工作区上下文",
              })
              await updateJob({
                job_id,
                status: "failed",
                current_stage: "coding",
                error_code: "coding_resume_missing_context",
                error_message: "自动恢复改码任务失败：缺少会话或工作区上下文",
              })
              return { ok: false as const, code: "coding_resume_missing_context" as const }
            }
            const workspace = await Workspace.get(job.workspace_id)
            const overlay = workspace ? BuildOverlay.fromWorkspace(workspace) : undefined
            if (!workspace || !overlay) {
              await markStage({
                job_id,
                stage: "coding",
                status: "failed",
                error_code: "overlay_workspace_missing",
                error_message: "自动恢复改码任务失败：找不到 overlay 工作区",
              })
              await updateJob({
                job_id,
                status: "failed",
                current_stage: "coding",
                error_code: "overlay_workspace_missing",
                error_message: "自动恢复改码任务失败：找不到 overlay 工作区",
              })
              return { ok: false as const, code: "overlay_workspace_missing" as const }
            }
            const stage = stageItem(stale_stage)
            await markStage({
              job_id,
              stage: "coding",
              status: "running",
              detail_json: {
                ...(stage.detail_json ?? {}),
                timed_out: true,
                timeout_ms,
                current_status: `改码阶段超过 ${timeoutText(timeout_ms)} 未收口，系统正在自动恢复并继续执行`,
              },
            })
            await updateJob({
              job_id,
              current_stage: "coding",
            })
            const { changes, snapshot } = await recoverTimedOutCoding({
              overlay,
              session_id: job.session_id,
              stage,
            })
            if (changes.length === 0) {
              await markStage({
                job_id,
                stage: "coding",
                status: "failed",
                error_code: "coding_timeout",
                error_message: `改码阶段超过 ${timeoutText(timeout_ms)} 仍未完成，且未恢复到有效代码变更`,
                detail_json: snapshot,
              })
              await updateJob({
                job_id,
                status: "failed",
                current_stage: "coding",
                plan_content: job.plan_content ?? job.prompt_text ?? undefined,
                error_code: "coding_timeout",
                error_message: `改码阶段超过 ${timeoutText(timeout_ms)} 仍未完成，且未恢复到有效代码变更`,
              })
              return { ok: false as const, code: "coding_timeout" as const }
            }
            await markStage({
              job_id,
              stage: "coding",
              status: "completed",
              detail_json: {
                ...(snapshot ?? {}),
                overlay_root: overlay.root,
                change_count: changes.length,
                changes,
                timed_out: true,
                timeout_ms,
                current_status: `改码阶段超过 ${timeoutText(timeout_ms)} 后由系统自动接管恢复，已继续进入编译阶段`,
              },
            })
            await updateJob({
              job_id,
              current_stage: "compile",
              plan_content: job.plan_content ?? job.prompt_text ?? undefined,
            })
            return {
              ok: true as const,
              session_id: job.session_id,
              overlay,
              changes,
            }
          })
        : await withAnchorProjectContext(project.id, async () => {
        const workspace = await Instance.provide({
          directory: project.worktree,
          fn: () =>
            Workspace.createOverlay({
              projectID: project.id,
              sourceRoots: [...new Set(member_rows.map((item) => item.directory))],
              members: member_rows,
              name: [product.name, job.id].join("-"),
            }),
        })
        const overlay = BuildOverlay.fromWorkspace(workspace)
        if (!overlay) return { ok: false as const, code: "overlay_workspace_missing" as const }
        const hints = await codingHints({
          text: job.plan_content ?? job.prompt_text ?? "",
          solutions,
          members: member_rows,
        })

        const session = await Instance.provide({
          directory: project.worktree,
          fn: () =>
            Session.createNext({
              directory: workspace.directory,
              title: `Build Job ${product.name}`,
              workspaceID: workspace.id,
              workspaceDirectory: workspace.directory,
              workspaceBranch: workspace.branch ?? undefined,
              workspaceKind: workspace.kind,
              workspaceStatus: "ready",
              workspaceCleanupStatus: "none",
            }),
        })

        await updateJob({
          job_id,
          session_id: session.id,
          workspace_id: workspace.id,
        })
        if (job.runtime_provider_id && job.runtime_model_id) {
          await Session.setRuntimeModel(session.id, {
            providerID: job.runtime_provider_id,
            modelID: job.runtime_model_id,
          })
        }

        await markStage({
          job_id,
          stage: "plan",
          status: "completed",
          detail_json: {
            source_type: job.source_type,
            solution_scope: job.solution_scope,
            solution_ids: solutions.map((item) => item.id),
            runtime_model:
              job.runtime_provider_id && job.runtime_model_id
                ? {
                    providerID: job.runtime_provider_id,
                    modelID: job.runtime_model_id,
                  }
                : undefined,
            prompt_text: job.prompt_text ?? undefined,
            plan_content: job.plan_content ?? undefined,
          },
        })
        await updateJob({
          job_id,
          current_stage: "coding",
          plan_content: job.plan_content ?? job.prompt_text ?? undefined,
        })

        await markStage({
          job_id,
          stage: "coding",
          status: "running",
          detail_json: {
            session_id: session.id,
            overlay_root: overlay.root,
            solutions: hints.map((item) => ({
              ...item,
              relative_path: item.mount_name,
            })),
          },
        })
        const coding_result = await Instance.provide({
          directory: workspace.directory,
          fn: async () => {
            try {
              const message = await withTimeout(
                SessionPrompt.prompt({
                  sessionID: session.id,
                  agent: "build",
                  parts: [
                    {
                      type: "text",
                      text: [
                        ...(job.source_type === "saved_plan"
                          ? [
                              "以下内容是已经确认并进入构建中心执行的计划，请不要重复输出计划。",
                              "禁止继续向用户提问、禁止等待确认，必须直接根据计划修改代码。",
                              "如果计划里出现“待确认”“需要确认”“示例文案”等字样，请直接采用计划中已有示例或选择最稳妥默认值后继续编码。",
                            ]
                          : ["请先输出简要计划，再根据计划直接修改代码。"]),
                        "本轮只需要完成代码修改，不要主动执行编译和打包。",
                        "必须实际使用工具修改工作区文件；如果没有改动，不要声称已经完成。",
                        hints.length > 0
                          ? [
                              "以下是本次参与解决方案的代码搜索提示，请优先根据这些提示定位代码，不要先按默认 Web 前端假设盲搜：",
                              ...hints.map((item) =>
                                [
                                  `方案：${item.solution_code}`,
                                  `挂载目录：${item.mount_name}`,
                                  `技术栈：${item.stack}`,
                                  item.compile_targets.length > 0 ? `编译目标：${item.compile_targets.join("、")}` : undefined,
                                  item.candidate_files.length > 0 ? `优先检查：${item.candidate_files.join("、")}` : undefined,
                                ]
                                  .filter(Boolean)
                                  .join("\n"),
                              ),
                              hints.some((item) => item.stack === ".NET/C#")
                                ? "如果是 .NET/C#、WinForms 或 WebForms 项目，请优先搜索 *.cs、*.Designer.cs、*.aspx、*.resx，不要先按 React/Vue 假设搜索 *.tsx。"
                                : undefined,
                            ]
                              .filter(Boolean)
                              .join("\n\n")
                          : undefined,
                        job.source_type === "saved_plan" ? `计划内容：${job.plan_content ?? ""}` : `用户需求：${job.prompt_text ?? ""}`,
                      ]
                        .filter(Boolean)
                        .join("\n\n"),
                    },
                  ],
                }),
                timeout_ms,
              )
              return {
                kind: "message" as const,
                message,
              }
            } catch (error) {
              if (error instanceof Error && error.message.includes("Operation timed out")) {
                SessionPrompt.cancel(session.id)
              }
              throw error
            }
          },
        }).catch(async (error) => {
          if (!(error instanceof Error) || !error.message.includes("Operation timed out")) throw error
          const stage = {
            id: "",
            job_id,
            stage: "coding" as const,
            status: "running",
            detail_json: {
              session_id: session.id,
              overlay_root: overlay.root,
              solutions: hints.map((item) => ({
                ...item,
                relative_path: item.mount_name,
              })),
            },
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          const { changes, snapshot } = await recoverTimedOutCoding({
            overlay,
            session_id: session.id,
            stage,
          })
          if (changes.length > 0) {
            return {
              kind: "timeout_with_changes" as const,
              changes,
              snapshot,
            }
          }
          await markStage({
            job_id,
            stage: "coding",
            status: "failed",
            error_code: "coding_timeout",
            error_message: `改码阶段超过 ${timeoutText(timeout_ms)} 仍未完成，已自动终止。`,
            detail_json: snapshot,
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "coding",
            plan_content: job.plan_content ?? job.prompt_text ?? undefined,
            error_code: "coding_timeout",
            error_message: `改码阶段超过 ${timeoutText(timeout_ms)} 仍未完成，已自动终止。`,
          })
          return
        })
        if (!coding_result) return { ok: false as const, code: "coding_timeout" as const }
        const plan_content =
          coding_result.kind === "message"
            ? assistantText(coding_result.message) ?? job.plan_content ?? job.prompt_text ?? ""
            : job.plan_content ?? job.prompt_text ?? ""
        const changes =
          coding_result.kind === "message"
            ? await recoverCodingChanges({
                overlay,
                session_id: session.id,
              })
            : coding_result.changes
        if (changes.length === 0) {
          await markStage({
            job_id,
            stage: "coding",
            status: "failed",
            error_code: "coding_no_changes",
            error_message: "AI 未在沙盒内产生任何代码变更",
            detail_json: {
              assistant_message_id: coding_result.kind === "message" ? coding_result.message.info.id : undefined,
              overlay_root: overlay.root,
            },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "coding",
            plan_content,
            error_code: "coding_no_changes",
            error_message: "AI 未在沙盒内产生任何代码变更",
          })
          return { ok: false as const, code: "coding_no_changes" as const }
        }
        await markStage({
          job_id,
          stage: "coding",
          status: "completed",
          detail_json: {
            assistant_message_id: coding_result.kind === "message" ? coding_result.message.info.id : undefined,
            overlay_root: overlay.root,
            change_count: changes.length,
            changes,
            timed_out: coding_result.kind === "timeout_with_changes",
            timeout_ms: coding_result.kind === "timeout_with_changes" ? timeout_ms : undefined,
            current_status:
              coding_result.kind === "timeout_with_changes"
                ? `改码阶段在 ${timeoutText(timeout_ms)} 后超时，但已检测到真实代码变更，已继续进入编译阶段`
                : undefined,
            recent_activity: coding_result.kind === "timeout_with_changes" ? coding_result.snapshot?.recent_activity : undefined,
          },
        })
        await updateJob({
          job_id,
          current_stage: "compile",
          plan_content,
        })
        return {
          ok: true as const,
          session_id: session.id,
          overlay,
          changes,
        }
      })
      if (!coding.ok) return coding
      const overlay = coding.overlay
      const targets = changedCompileTargets({
        solutions,
        changes: coding.changes,
      })

      await markStage({
        job_id,
        stage: "compile",
        status: "running",
      })
      const compile_logs = [...targets.skipped] as Array<Record<string, unknown>>
      for (const solution of targets.items) {
        const profile = normalizeBuildProfile(solution.build_profile)
        if (placeholder(profile.compile_command)) {
          compile_logs.push({
            solution_id: solution.id,
            solution_code: solution.code,
            logs: [
              {
                step: "validate",
                exit_code: 1,
                stderr: "compile_command_unconfigured",
              },
            ],
          })
          await markStage({
            job_id,
            stage: "compile",
            status: "failed",
            error_code: "compile_command_unconfigured",
            error_message: "当前解决方案仍在使用默认占位编译命令，请先配置真实 compile_command",
            detail_json: { solutions: compile_logs },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "compile",
            error_code: "compile_command_unconfigured",
            error_message: "当前解决方案仍在使用默认占位编译命令，请先配置真实 compile_command",
          })
          return { ok: false as const, code: "compile_command_unconfigured" as const }
        }
        const solution_members = await members(solution)
        await markCompileRunning({
          job_id,
          solutions: compile_logs,
          active: {
            solution_id: solution.id,
            solution_code: solution.code,
            current_step: "prepare_compile_sandbox",
            current_status: "正在准备独立编译沙盒",
            source_roots: [...new Set(solution_members.map((item) => item.directory))],
            requested_workdirs: profile.workdirs.length > 0 ? profile.workdirs : ["."],
          },
        })
        const compile_sandbox = await withTimeout(
          BuildCompileSandbox.create({
            projectID: project.id,
            name: [job.id, solution.code, "compile"].join("-"),
            sourceRoots: [...new Set(solution_members.map((item) => item.directory))],
            members: solution_members,
            overlay,
            changes: coding.changes,
            solution,
          }),
          compile_prepare_timeout_ms,
        ).catch((error) => error)
        if (compile_sandbox instanceof Error) {
          const timed_out = compile_sandbox.message.includes("Operation timed out")
          const code = timed_out ? "compile_sandbox_timeout" : "compile_sandbox_failed"
          const error_message = timed_out
            ? `准备编译沙盒超时，${timeoutText(compile_prepare_timeout_ms)} 内未完成`
            : compile_sandbox.message || "准备编译沙盒失败"
          compile_logs.push({
            solution_id: solution.id,
            solution_code: solution.code,
            source_roots: [...new Set(solution_members.map((item) => item.directory))],
            requested_workdirs: profile.workdirs.length > 0 ? profile.workdirs : ["."],
            logs: [
              {
                step: "prepare_compile_sandbox",
                exit_code: timed_out ? 124 : 1,
                stderr: error_message,
              },
            ],
          })
          await markStage({
            job_id,
            stage: "compile",
            status: "failed",
            error_code: code,
            error_message,
            detail_json: { solutions: compile_logs },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "compile",
            error_code: code,
            error_message,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code }
        }
        compile_sandboxes.push({
          workspace_id: compile_sandbox.workspace.id,
          workspace_directory: compile_sandbox.workspace.directory,
          solution,
          profile,
        })
        await markCompileRunning({
          job_id,
          solutions: compile_logs,
          active: {
            solution_id: solution.id,
            solution_code: solution.code,
            current_step: "resolve_workdirs",
            current_status: "正在解析编译目录",
            requested_workdirs: profile.workdirs.length > 0 ? profile.workdirs : ["."],
            compile_sandbox_directory: compile_sandbox.workspace.directory,
            applied_files_count: compile_sandbox.applied.length,
          },
        })
        const resolved = await workdirs({
          workspaceDirectory: compile_sandbox.workspace.directory,
          workdirs: profile.workdirs.length > 0 ? profile.workdirs : ["."],
          mounts: solution_members.map((item) => item.relative_path),
        })
        if (!resolved.ok) {
          compile_logs.push({
            solution_id: solution.id,
            solution_code: solution.code,
            logs: [
              {
                step: "validate",
                exit_code: 1,
                stderr: `missing workdirs: ${resolved.missing.join(", ")}`,
              },
            ],
            compile_sandbox_directory: compile_sandbox.workspace.directory,
            applied_files_count: compile_sandbox.applied.length,
          })
          await markStage({
            job_id,
            stage: "compile",
            status: "failed",
            error_code: resolved.code,
            error_message: `以下 workdir 在构建沙盒中不存在：${resolved.missing.join(", ")}`,
            detail_json: { solutions: compile_logs },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "compile",
            error_code: resolved.code,
            error_message: `以下 workdir 在构建沙盒中不存在：${resolved.missing.join(", ")}`,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code: resolved.code }
        }
        if (process.platform !== "win32" && windowsOnly(profile.compile_command)) {
          const error_message = `当前解决方案的编译命令是 Windows PowerShell/MSBuild 脚本，只能在 Windows 构建节点执行。当前节点: ${process.platform}`
          compile_logs.push({
            solution_id: solution.id,
            solution_code: solution.code,
            requested_workdirs: resolved.requested,
            resolved_workdirs: resolved.resolved,
            warnings: resolved.warnings,
            compile_sandbox_directory: compile_sandbox.workspace.directory,
            applied_files_count: compile_sandbox.applied.length,
            required_platform: "win32",
            current_platform: process.platform,
            logs: [
              {
                step: "compile",
                exit_code: 1,
                stderr: error_message,
              },
            ],
          })
          await markStage({
            job_id,
            stage: "compile",
            status: "failed",
            error_code: "compile_platform_unsupported",
            error_message,
            detail_json: { solutions: compile_logs },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "compile",
            error_code: "compile_platform_unsupported",
            error_message,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code: "compile_platform_unsupported" as const }
        }
        const solution_logs = [] as Array<Record<string, unknown>>
        for (const item of resolved.items) {
          const workdir = item.workdir
          const cwd = item.cwd
          if (profile.install_command?.trim()) {
            await markCompileRunning({
              job_id,
              solutions: compile_logs,
              active: {
                solution_id: solution.id,
                solution_code: solution.code,
                current_step: "install",
                current_status: "正在安装依赖",
                command: profile.install_command,
                cwd,
                workdir,
                requested_workdirs: resolved.requested,
                resolved_workdirs: resolved.resolved,
                warnings: resolved.warnings,
                compile_sandbox_directory: compile_sandbox.workspace.directory,
                applied_files_count: compile_sandbox.applied.length,
              },
            })
            const install = await shell(profile.install_command, cwd, compile_command_timeout_ms)
            solution_logs.push({
              workdir,
              step: "install",
              exit_code: install.exitCode,
              stdout: install.stdout,
              stderr: install.stderr,
            })
            if (install.timed_out) {
              compile_logs.push({
                solution_id: solution.id,
                solution_code: solution.code,
                requested_workdirs: resolved.requested,
                resolved_workdirs: resolved.resolved,
                warnings: resolved.warnings,
                logs: solution_logs,
                command: profile.install_command,
                cwd,
                compile_sandbox_directory: compile_sandbox.workspace.directory,
                applied_files_count: compile_sandbox.applied.length,
              })
              await markStage({
                job_id,
                stage: "compile",
                status: "failed",
                error_code: "install_timeout",
                error_message: `依赖安装超时，${timeoutText(compile_command_timeout_ms)} 内未完成`,
                detail_json: { solutions: compile_logs },
              })
              await updateJob({
                job_id,
                status: "failed",
                current_stage: "compile",
                error_code: "install_timeout",
                error_message: `依赖安装超时，${timeoutText(compile_command_timeout_ms)} 内未完成`,
              })
              await cleanupCompileSandboxes(compile_sandboxes)
              return { ok: false as const, code: "install_timeout" as const }
            }
            if (install.exitCode !== 0) {
              compile_logs.push({
                solution_id: solution.id,
                solution_code: solution.code,
                requested_workdirs: resolved.requested,
                resolved_workdirs: resolved.resolved,
                warnings: resolved.warnings,
                logs: solution_logs,
                command: profile.install_command,
                cwd,
                compile_sandbox_directory: compile_sandbox.workspace.directory,
                applied_files_count: compile_sandbox.applied.length,
              })
              await markStage({
                job_id,
                stage: "compile",
                status: "failed",
                error_code: "install_failed",
                error_message: install.stderr || "install_failed",
                detail_json: { solutions: compile_logs },
              })
              await updateJob({
                job_id,
                status: "failed",
                current_stage: "compile",
                error_code: "install_failed",
                error_message: install.stderr || "install_failed",
              })
              await cleanupCompileSandboxes(compile_sandboxes)
              return { ok: false as const, code: "install_failed" as const }
            }
          }
          await markCompileRunning({
            job_id,
            solutions: compile_logs,
            active: {
              solution_id: solution.id,
              solution_code: solution.code,
              current_step: "compile",
              current_status: "正在执行编译命令",
              command: profile.compile_command,
              cwd,
              workdir,
              requested_workdirs: resolved.requested,
              resolved_workdirs: resolved.resolved,
              warnings: resolved.warnings,
              compile_sandbox_directory: compile_sandbox.workspace.directory,
              applied_files_count: compile_sandbox.applied.length,
            },
          })
          const compile = await shell(profile.compile_command, cwd, compile_command_timeout_ms)
          solution_logs.push({
            workdir,
            step: "compile",
            exit_code: compile.exitCode,
            stdout: compile.stdout,
            stderr: compile.stderr,
          })
          if (compile.timed_out) {
            compile_logs.push({
              solution_id: solution.id,
              solution_code: solution.code,
              requested_workdirs: resolved.requested,
              resolved_workdirs: resolved.resolved,
              warnings: resolved.warnings,
              logs: solution_logs,
              command: profile.compile_command,
              cwd,
              compile_sandbox_directory: compile_sandbox.workspace.directory,
              applied_files_count: compile_sandbox.applied.length,
            })
            await markStage({
              job_id,
              stage: "compile",
              status: "failed",
              error_code: "compile_timeout",
              error_message: `编译超时，${timeoutText(compile_command_timeout_ms)} 内未完成`,
              detail_json: { solutions: compile_logs },
            })
            await updateJob({
              job_id,
              status: "failed",
              current_stage: "compile",
              error_code: "compile_timeout",
              error_message: `编译超时，${timeoutText(compile_command_timeout_ms)} 内未完成`,
            })
            await cleanupCompileSandboxes(compile_sandboxes)
            return { ok: false as const, code: "compile_timeout" as const }
          }
          if (compile.exitCode !== 0) {
            compile_logs.push({
              solution_id: solution.id,
              solution_code: solution.code,
              requested_workdirs: resolved.requested,
              resolved_workdirs: resolved.resolved,
              warnings: resolved.warnings,
              logs: solution_logs,
              command: profile.compile_command,
              cwd,
              compile_sandbox_directory: compile_sandbox.workspace.directory,
              applied_files_count: compile_sandbox.applied.length,
            })
            await markStage({
              job_id,
              stage: "compile",
              status: "failed",
              error_code: "compile_failed",
              error_message: compile.stderr || "compile_failed",
              detail_json: { solutions: compile_logs },
            })
            await updateJob({
              job_id,
              status: "failed",
              current_stage: "compile",
              error_code: "compile_failed",
              error_message: compile.stderr || "compile_failed",
            })
            await cleanupCompileSandboxes(compile_sandboxes)
            return { ok: false as const, code: "compile_failed" as const }
          }
        }
        compile_logs.push({
          solution_id: solution.id,
          solution_code: solution.code,
          requested_workdirs: resolved.requested,
          resolved_workdirs: resolved.resolved,
          warnings: resolved.warnings,
          logs: solution_logs,
          compile_sandbox_directory: compile_sandbox.workspace.directory,
          applied_files_count: compile_sandbox.applied.length,
        })
      }
      await markStage({
        job_id,
        stage: "compile",
        status: "completed",
        detail_json: { solutions: compile_logs },
      })
      await updateJob({
        job_id,
        current_stage: "package",
      })

      await markStage({
        job_id,
        stage: "package",
        status: "running",
      })
      const outputDirectory = path.join(project.worktree, "ai_build_zip", job.id)
      await fs.mkdir(outputDirectory, { recursive: true })
      const packaged = [] as Array<Record<string, unknown>>
      for (const sandbox of compile_sandboxes) {
        const solution = sandbox.solution
        const profile = sandbox.profile
        const resolved = await workdirs({
          workspaceDirectory: sandbox.workspace_directory,
          workdirs: profile.workdirs.length > 0 ? profile.workdirs : ["."],
          mounts: (await members(solution)).map((item) => item.relative_path),
        })
        if (!resolved.ok) {
          await markStage({
            job_id,
            stage: "package",
            status: "failed",
            error_code: resolved.code,
            error_message: `以下 workdir 在构建沙盒中不存在：${resolved.missing.join(", ")}`,
            detail_json: { solutions: packaged },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "package",
            error_code: resolved.code,
            error_message: `以下 workdir 在构建沙盒中不存在：${resolved.missing.join(", ")}`,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code: resolved.code }
        }
        const stageDirectory = path.join(Global.Path.runtime, "build-job-stage", job.id, solution.code)
        await markPackageRunning({
          job_id,
          solutions: packaged,
          active: {
            solution_id: solution.id,
            solution_code: solution.code,
            current_step: "stage_artifacts",
            current_status: "正在收集编译产物",
            requested_workdirs: resolved.requested,
            resolved_workdirs: resolved.resolved,
            warnings: resolved.warnings,
            compile_sandbox_directory: sandbox.workspace_directory,
            output_directory: outputDirectory,
            stage_directory: stageDirectory,
          },
        })
        const staged = await withTimeout(
          stageArtifacts({
            workspaceDirectory: sandbox.workspace_directory,
            stageDirectory,
            workdirs: resolved.items.map((item) => item.workdir),
            build_profile: profile,
          }),
          package_timeout_ms,
        ).catch((error) => error)
        if (staged instanceof Error) {
          const timed_out = staged.message.includes("Operation timed out")
          const code = timed_out ? "package_timeout" : "package_failed"
          const error_message = timed_out
            ? `收集产物超时，${timeoutText(package_timeout_ms)} 内未完成`
            : staged.message || "收集产物失败"
          packaged.push({
            solution_id: solution.id,
            solution_code: solution.code,
            requested_workdirs: resolved.requested,
            resolved_workdirs: resolved.resolved,
            warnings: resolved.warnings,
            compile_sandbox_directory: sandbox.workspace_directory,
            output_directory: outputDirectory,
            stage_directory: stageDirectory,
            logs: [
              {
                step: "stage_artifacts",
                exit_code: timed_out ? 124 : 1,
                stderr: error_message,
              },
            ],
          })
          await markStage({
            job_id,
            stage: "package",
            status: "failed",
            error_code: code,
            error_message,
            detail_json: { solutions: packaged },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "package",
            error_code: code,
            error_message,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code }
        }
        if (!staged.ok) {
          await markStage({
            job_id,
            stage: "package",
            status: "failed",
            error_code: staged.code,
            error_message: staged.code,
            detail_json: { solutions: packaged },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "package",
            error_code: staged.code,
            error_message: staged.code,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code: staged.code }
        }
        const file_name = outputName(profile.output_name_template, {
          solution: solution.code,
          job: job.id,
        })
        const file_path = path.join(outputDirectory, file_name)
        await markPackageRunning({
          job_id,
          solutions: packaged,
          active: {
            solution_id: solution.id,
            solution_code: solution.code,
            current_step: "archive_zip",
            current_status: "正在压缩发布包",
            requested_workdirs: resolved.requested,
            resolved_workdirs: resolved.resolved,
            warnings: [...resolved.warnings, ...(staged.ok ? staged.warnings : [])],
            matched_patterns: staged.ok ? staged.matched_patterns : undefined,
            compile_sandbox_directory: sandbox.workspace_directory,
            output_directory: outputDirectory,
            stage_directory: stageDirectory,
            file_name,
            file_path,
          },
        })
        const archived = await withTimeout(
          Archive.createZip({
            sourceDir: stageDirectory,
            output: file_path,
          }),
          package_timeout_ms,
        ).catch((error) => error)
        if (archived instanceof Error) {
          const timed_out = archived.message.includes("Operation timed out")
          const code = timed_out ? "package_timeout" : "package_failed"
          const error_message = timed_out
            ? `压缩发布包超时，${timeoutText(package_timeout_ms)} 内未完成`
            : archived.message || "压缩发布包失败"
          packaged.push({
            solution_id: solution.id,
            solution_code: solution.code,
            requested_workdirs: resolved.requested,
            resolved_workdirs: resolved.resolved,
            warnings: [...resolved.warnings, ...(staged.ok ? staged.warnings : [])],
            matched_patterns: staged.ok ? staged.matched_patterns : undefined,
            compile_sandbox_directory: sandbox.workspace_directory,
            output_directory: outputDirectory,
            stage_directory: stageDirectory,
            file_name,
            file_path,
            logs: [
              {
                step: "archive_zip",
                exit_code: timed_out ? 124 : 1,
                stderr: error_message,
              },
            ],
          })
          await markStage({
            job_id,
            stage: "package",
            status: "failed",
            error_code: code,
            error_message,
            detail_json: { solutions: packaged },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "package",
            error_code: code,
            error_message,
          })
          await cleanupCompileSandboxes(compile_sandboxes)
          return { ok: false as const, code }
        }
        const hash = createHash("sha1").update(Buffer.from(await Bun.file(file_path).arrayBuffer())).digest("hex")
        const size = await Filesystem.size(file_path)
        await Database.use((db) =>
          db
            .insert(TpBuildArtifactTable)
            .values({
              id: ulid(),
              job_id,
              solution_id: solution.id,
              file_name,
              file_path,
              size,
              hash,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        packaged.push({
          solution_id: solution.id,
          solution_code: solution.code,
          requested_workdirs: resolved.requested,
          resolved_workdirs: resolved.resolved,
          warnings: [...resolved.warnings, ...(staged.ok ? staged.warnings : [])],
          compile_sandbox_directory: sandbox.workspace_directory,
          stage_directory: stageDirectory,
          matched_patterns: staged.ok ? staged.matched_patterns : undefined,
          file_name,
          file_path,
          size,
        })
      }
      await cleanupCompileSandboxes(compile_sandboxes)
      await markStage({
        job_id,
        stage: "package",
        status: "completed",
        detail_json: { solutions: packaged },
      })
      await updateJob({
        job_id,
        status: "completed",
        current_stage: "package",
      })
      return { ok: true as const, detail: await detail(job_id) }
    } catch (error) {
      await cleanupCompileSandboxes(compile_sandboxes).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      const stage = (await detail(job_id))?.job.current_stage as BuildStage | undefined
      if (stage && stages.includes(stage)) {
        await markStage({
          job_id,
          stage,
          status: "failed",
          error_code: "build_job_failed",
          error_message: message,
        }).catch(() => undefined)
      }
      await updateJob({
        job_id,
        status: "failed",
        error_code: "build_job_failed",
        error_message: message,
      }).catch(() => undefined)
      return { ok: false as const, code: "build_job_failed" as const, message }
    }
  }
}
