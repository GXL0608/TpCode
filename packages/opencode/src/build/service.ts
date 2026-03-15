import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { ulid } from "ulid"
import { Archive } from "@/util/archive"
import { BuildProfile, normalizeBuildProfile } from "./profile"
import { Database, and, asc, desc, eq, inArray } from "@/storage/db"
import { TpBuildArtifactTable } from "./artifact.sql"
import { TpBuildJobTable } from "./job.sql"
import { TpBuildJobStageTable } from "./job-stage.sql"
import { ProductSolutionService } from "@/user/product-solution"
import { TpProductTable } from "@/user/product.sql"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Workspace } from "@/control-plane/workspace"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Global } from "@/global"
import { TpSavedPlanTable } from "@/plan/saved-plan.sql"
import { type ProductSolutionItem } from "@/user/product-solution"

const stages = ["plan", "coding", "compile", "package"] as const
type BuildStage = (typeof stages)[number]

type JobRow = typeof TpBuildJobTable.$inferSelect

type BuildJobItem = {
  id: string
  source_type: string
  source_id?: string
  prompt_text?: string
  product_id: string
  solution_id: string
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

/** 中文注释：统一把数据库中的 build job 主记录转换为稳定返回结构。 */
function jobItem(row: JobRow): BuildJobItem {
  return {
    id: row.id,
    source_type: row.source_type,
    source_id: row.source_id ?? undefined,
    prompt_text: row.prompt_text ?? undefined,
    product_id: row.product_id,
    solution_id: row.solution_id,
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

/** 中文注释：跨平台执行编译或安装命令，Windows 固定走 PowerShell，其它系统走 sh。 */
async function shell(command: string, cwd: string) {
  if (process.platform === "win32") {
    return $`powershell -NoProfile -NonInteractive -Command ${command}`.quiet().nothrow().cwd(cwd)
  }
  return $`sh -lc ${command}`.quiet().nothrow().cwd(cwd)
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

/** 中文注释：为解决方案 roots 收集显式批量成员，兼容单仓、父目录扫描和虚拟目录组。 */
async function members(solution: ProductSolutionItem) {
  const list = [] as Array<{ directory: string; name: string; relative_path: string }>
  for (const root of solution.roots.filter((item) => item.enabled)) {
    if (root.root_type === "single_repo") {
      const name = root.display_name?.trim() || path.basename(root.directory)
      list.push({
        directory: root.directory,
        name,
        relative_path: name,
      })
      continue
    }
    if (root.root_type === "parent_batch") {
      const entries = await fs.readdir(root.directory, { withFileTypes: true }).catch(() => [])
      const children = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const directory = path.join(root.directory, entry.name)
            if (!(await Filesystem.exists(path.join(directory, ".git")))) return
            return {
              directory,
              name: entry.name,
              relative_path: entry.name,
            }
          }),
      )
      list.push(...children.filter((item): item is NonNullable<typeof item> => Boolean(item)))
      continue
    }
    for (const directory of root.meta?.directories ?? []) {
      const name = path.basename(directory)
      list.push({
        directory,
        name,
        relative_path: name,
      })
    }
  }
  const seen = new Set<string>()
  return list.filter((item) => {
    const key = path.resolve(item.directory)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 中文注释：把匹配到的编译产物复制到 staging 目录，便于后续统一压缩打包。 */
async function stageArtifacts(input: {
  workspaceDirectory: string
  stageDirectory: string
  workdirs: string[]
  build_profile: ReturnType<typeof normalizeBuildProfile>
}) {
  const files = new Set<string>()
  for (const workdir of input.workdirs) {
    const cwd = path.join(input.workspaceDirectory, workdir)
    const include = input.build_profile.artifact_include.length > 0 ? input.build_profile.artifact_include : ["**/*"]
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
  return { ok: true as const, files: [...files] }
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
  return {
    job: jobItem(row),
    stages: stage_rows.map(stageItem),
    artifacts: artifact_rows.map(artifactItem),
  } satisfies BuildJobDetail
}

export namespace BuildJobService {
  export async function create(input: {
    source_type: "prompt" | "saved_plan"
    product_id: string
    solution_id?: string
    prompt_text?: string
    saved_plan_id?: string
  }) {
    const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, input.product_id)).get())
    if (!product) return { ok: false as const, code: "product_missing" as const }
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
          solution_id: solution.id,
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
    return { ok: true as const, job: next.job }
  }

  export async function createBatch(input: {
    product_id: string
    solution_id?: string
    saved_plan_ids: string[]
  }) {
    const jobs = [] as BuildJobItem[]
    for (const saved_plan_id of input.saved_plan_ids) {
      const created = await create({
        source_type: "saved_plan",
        product_id: input.product_id,
        solution_id: input.solution_id,
        saved_plan_id,
      })
      if (!created.ok) return created
      jobs.push(created.job)
    }
    return { ok: true as const, jobs }
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
      const conditions = [] as ReturnType<typeof eq>[]
      if (input.product_id) conditions.push(eq(TpBuildJobTable.product_id, input.product_id))
      if (input.solution_id) conditions.push(eq(TpBuildJobTable.solution_id, input.solution_id))
      if (input.status) conditions.push(eq(TpBuildJobTable.status, input.status))
      return db
        .select()
        .from(TpBuildJobTable)
        .where(and(...conditions))
        .orderBy(desc(TpBuildJobTable.time_created))
        .limit(limit)
        .all()
    })
    return rows.map(jobItem)
  }

  export async function get(job_id: string) {
    return detail(job_id)
  }

  export async function artifact(artifact_id: string) {
    const row = await Database.use((db) => db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.id, artifact_id)).get())
    if (!row) return
    return artifactItem(row)
  }

  /** 中文注释：执行单条 build job，按计划、编码、编译、打包四阶段串行推进。 */
  export async function run(job_id: string) {
    const job = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job_id)).get())
    if (!job) return { ok: false as const, code: "build_job_missing" as const }
    if (job.status === "completed") return { ok: true as const, detail: await detail(job_id) }
    if (job.started && job.status === "running") return { ok: false as const, code: "build_job_running" as const }

    const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, job.product_id)).get())
    if (!product) return { ok: false as const, code: "product_missing" as const }
    const solution = await ProductSolutionService.get(job.solution_id)
    if (!solution) return { ok: false as const, code: "solution_missing" as const }
    const profile = normalizeBuildProfile(solution.build_profile)
    const member_rows = await members(solution)
    if (member_rows.length === 0) return { ok: false as const, code: "solution_root_missing" as const }

    await updateJob({
      job_id,
      status: "running",
      started: true,
    })

    try {
      const project = await Project.get(product.project_id)
      if (!project) return { ok: false as const, code: "project_missing" as const }

      const workspace = await Instance.provide({
        directory: project.worktree,
        fn: () =>
          Workspace.createBatch({
            projectID: project.id,
            sourceRoots: solution.roots.map((item) => item.directory),
            members: member_rows,
            name: [solution.code, job.id].join("-"),
          }),
      })

      const session = await Instance.provide({
        directory: project.worktree,
        fn: () =>
          Session.createNext({
            directory: workspace.directory,
            title: `Build Job ${solution.name}`,
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

      await markStage({
        job_id,
        stage: "plan",
        status: "completed",
        detail_json: {
          source_type: job.source_type,
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
      })
      const message = await Instance.provide({
        directory: workspace.directory,
        fn: () =>
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [
              {
                type: "text",
                text: [
                  "请先输出简要计划，再根据计划直接修改代码。",
                  "本轮只需要完成代码修改，不要主动执行编译和打包。",
                  job.source_type === "saved_plan" ? `计划内容：${job.plan_content ?? ""}` : `用户需求：${job.prompt_text ?? ""}`,
                ].join("\n\n"),
              },
            ],
          }),
      })
      const plan_content = assistantText(message) ?? job.plan_content ?? job.prompt_text ?? ""
      await markStage({
        job_id,
        stage: "coding",
        status: "completed",
        detail_json: {
          assistant_message_id: message.info.id,
        },
      })
      await updateJob({
        job_id,
        current_stage: "compile",
        plan_content,
      })

      await markStage({
        job_id,
        stage: "compile",
        status: "running",
      })
      const workdirs = profile.workdirs.length > 0 ? profile.workdirs : ["."]
      const compile_logs = [] as Array<Record<string, unknown>>
      for (const workdir of workdirs) {
        const cwd = path.join(workspace.directory, workdir)
        if (!(await Filesystem.isDir(cwd))) continue
        if (profile.install_command?.trim()) {
          const install = await shell(profile.install_command, cwd)
          compile_logs.push({
            workdir,
            step: "install",
            exit_code: install.exitCode,
            stdout: install.stdout.toString().trim(),
            stderr: install.stderr.toString().trim(),
          })
          if (install.exitCode !== 0) {
            await markStage({
              job_id,
              stage: "compile",
              status: "failed",
              error_code: "install_failed",
              error_message: install.stderr.toString().trim() || "install_failed",
              detail_json: { logs: compile_logs },
            })
            await updateJob({
              job_id,
              status: "failed",
              current_stage: "compile",
              error_code: "install_failed",
              error_message: install.stderr.toString().trim() || "install_failed",
            })
            return { ok: false as const, code: "install_failed" as const }
          }
        }
        const compile = await shell(profile.compile_command, cwd)
        compile_logs.push({
          workdir,
          step: "compile",
          exit_code: compile.exitCode,
          stdout: compile.stdout.toString().trim(),
          stderr: compile.stderr.toString().trim(),
        })
        if (compile.exitCode !== 0) {
          await markStage({
            job_id,
            stage: "compile",
            status: "failed",
            error_code: "compile_failed",
            error_message: compile.stderr.toString().trim() || "compile_failed",
            detail_json: { logs: compile_logs },
          })
          await updateJob({
            job_id,
            status: "failed",
            current_stage: "compile",
            error_code: "compile_failed",
            error_message: compile.stderr.toString().trim() || "compile_failed",
          })
          return { ok: false as const, code: "compile_failed" as const }
        }
      }
      await markStage({
        job_id,
        stage: "compile",
        status: "completed",
        detail_json: { logs: compile_logs },
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
      const stageDirectory = path.join(Global.Path.data, "build-job-stage", job.id, solution.code)
      const staged = await stageArtifacts({
        workspaceDirectory: workspace.directory,
        stageDirectory,
        workdirs,
        build_profile: profile,
      })
      if (!staged.ok) {
        await markStage({
          job_id,
          stage: "package",
          status: "failed",
          error_code: staged.code,
          error_message: staged.code,
        })
        await updateJob({
          job_id,
          status: "failed",
          current_stage: "package",
          error_code: staged.code,
          error_message: staged.code,
        })
        return { ok: false as const, code: staged.code }
      }
      const outputDirectory = path.join(project.worktree, "ai_build_zip", job.id)
      await fs.mkdir(outputDirectory, { recursive: true })
      const file_name = outputName(profile.output_name_template, {
        solution: solution.code,
        job: job.id,
      })
      const file_path = path.join(outputDirectory, file_name)
      await Archive.createZip({
        sourceDir: stageDirectory,
        output: file_path,
      })
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
      await markStage({
        job_id,
        stage: "package",
        status: "completed",
        detail_json: {
          file_name,
          file_path,
          size,
        },
      })
      await updateJob({
        job_id,
        status: "completed",
        current_stage: "package",
      })
      return { ok: true as const, detail: await detail(job_id) }
    } catch (error) {
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
