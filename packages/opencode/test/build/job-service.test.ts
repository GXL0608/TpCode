import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Database, eq, sql } from "../../src/storage/db"
import { TpBuildArtifactTable } from "../../src/build/artifact.sql"
import { TpBuildJobTable } from "../../src/build/job.sql"
import { TpBuildJobStageTable } from "../../src/build/job-stage.sql"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { BuildJobService } from "../../src/build/service"
import { BuildCompileSandbox } from "../../src/build/compile-sandbox"
import { Workspace } from "../../src/control-plane/workspace"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { Session } from "../../src/session"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { SessionPrompt } from "../../src/session/prompt"
import { AccountCurrent } from "../../src/user/current"
import { Project } from "../../src/project/project"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建一个最小 git 仓库，并写入可被编译阶段复制的源文件。 */
async function createRepo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "source.txt"), `${name}\n`)
  await $`git add source.txt`.cwd(directory).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

/** 中文注释：创建一个最小非 Git 目录，供共享目录或普通文件夹构建测试复用。 */
async function createFolder(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await Bun.write(path.join(directory, "source.txt"), `${name}\n`)
  return directory
}

/** 中文注释：按共享目录组件拼装稳定 UNC 路径，避免测试字符串字面量中的反斜杠和中文发生转义歧义。 */
function unc(...parts: string[]) {
  return ["", "", "192.168.1.202", ...parts].join("\\")
}

/** 中文注释：在构建测试里直接修改沙盒文件，模拟 AI 已经真正完成代码改动。 */
async function touchWorkspace(session_id: string, files: string[]) {
  const session = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session_id)).get())
  if (!session?.workspace_directory) throw new Error(`workspace_missing:${session_id}`)
  for (const file of files) {
    const target = path.join(session.workspace_directory, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, `changed:${session_id}\n`, "utf-8")
  }
}

/** 中文注释：向测试会话写入一个已完成的 edit 工具结果，模拟 Windows 上真实改码已发生但 overlay manifest 丢失的恢复场景。 */
async function insertCompletedEdit(input: {
  session_id: string
  file: string
  before: string
  after: string
  suffix?: string
  time_created?: number
}) {
  const session = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, input.session_id)).get())
  if (!session?.workspace_directory) throw new Error(`workspace_missing:${input.session_id}`)
  const filePath = path.join(session.workspace_directory, input.file)
  const now = input.time_created ?? Date.now()
  const suffix = input.suffix ?? ""
  const message_id = `message_${input.session_id}${suffix}`
  await Database.use((db) =>
    db
      .insert(MessageTable)
      .values({
        id: message_id,
        session_id: input.session_id,
        time_created: now,
        time_updated: now,
        data: {
          role: "assistant",
          time: {
            created: now,
            completed: now,
          },
          parentID: `user_${input.session_id}`,
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          agent: "build",
          path: {
            cwd: session.workspace_directory,
            root: session.workspace_directory,
          },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
          finish: "tool-calls",
        },
      })
      .run(),
  )
  await Database.use((db) =>
    db
      .insert(PartTable)
      .values({
        id: `part_${input.session_id}${suffix}`,
        session_id: input.session_id,
        message_id,
        time_created: now,
        time_updated: now,
        data: {
          type: "tool",
          callID: `call_${input.session_id}${suffix}`,
          tool: "edit",
          state: {
            status: "completed",
            input: {
              filePath,
              oldString: input.before,
              newString: input.after,
            },
            output: "Edit applied successfully.",
            title: input.file,
            metadata: {
              diff: "",
              filediff: {
                file: filePath,
                before: input.before,
                after: input.after,
                additions: 1,
                deletions: 1,
              },
            },
            time: {
              start: now,
              end: now,
            },
          },
        },
      })
      .run(),
  )
}

/** 中文注释：插入一条最小化已保存计划记录，供构建中心执行计划测试直接复用。 */
async function savePlan(input: {
  product_id: string
  project_id: string
  project_worktree: string
  session_title: string
  plan_content: string
}) {
  const now = Date.now()
  const id = `plan_${now}_${Math.random().toString(36).slice(2, 8)}`
  await Database.use((db) =>
    db
      .insert(TpSavedPlanTable)
      .values({
        id,
        session_id: `session_${id}`,
        message_id: `message_${id}`,
        part_id: `part_${id}`,
        product_id: input.product_id,
        project_id: input.project_id,
        project_name: input.project_id,
        project_worktree: input.project_worktree,
        session_title: input.session_title,
        user_id: "user_build_test",
        username: "build_test",
        display_name: "构建测试",
        account_type: "internal",
        org_id: "org_tp_internal",
        department_id: "dept_tp_rnd",
        agent: "plan",
        provider_id: "openai",
        model_id: "gpt-5.2",
        message_created_at: now,
        plan_content: input.plan_content,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

describe("build job service", () => {
  afterEach(async () => {
    mock.restore()
    delete process.env.TPCODE_SHARED_MOUNT_ROOT
    await Database.use(async (db) => {
      await db.delete(TpBuildArtifactTable).run()
      await db.delete(TpBuildJobStageTable).run()
      await db.delete(TpBuildJobTable).run()
      await db.delete(WorkspaceTable).run()
      await db.delete(TpProductSolutionRootTable).run()
      await db.delete(TpProductSolutionTable).run()
      await db.delete(TpProductTable).run()
    })
  })

  test("runs prompt build job, compiles outputs and writes deployment zip", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "frontend")

    const product = await AccountProductService.create({
      name: "门诊系统",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端站点",
      code: "frontend-site",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "前端站点",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const prompt = spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      return {
        info: {
          id: "message_build_mock",
          sessionID: "session_build_mock",
          parentID: "message_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_build_mock",
            sessionID: "session_build_mock",
            messageID: "message_build_mock",
            type: "text",
            text: "先同步需求计划，再完成代码修改。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "把前端站点打成可发布包",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const stages = await Database.use((db) =>
      db.select().from(TpBuildJobStageTable).where(eq(TpBuildJobStageTable.job_id, job.job.id)).all(),
    )
    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )

    expect(stored?.status).toBe("completed")
    expect([...new Set(stages.map((item) => item.stage))].sort()).toEqual(["plan", "coding", "compile", "package"].sort())
    expect(artifacts).toHaveLength(1)
    expect(await Bun.file(artifacts[0]!.file_path).exists()).toBe(true)
    expect(artifacts[0]!.file_name.endsWith(".zip")).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("reuses the bound build session instead of creating a new session", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "frontend")

    const product = await AccountProductService.create({
      name: "复用会话产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "复用会话方案",
      code: "reuse-session",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "复用会话方案",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const project = await Project.get(product.item.project_id!)
    expect(project).toBeTruthy()
    if (!project) return

    const workspace = await Instance.provide({
      directory: project.worktree,
      fn: () =>
        Workspace.createOverlay({
          projectID: project.id,
          sourceRoots: [repo],
          members: [
            {
              directory: repo,
              name: "frontend",
              relative_path: "frontend",
              solution_id: solution.item.id,
              solution_code: solution.item.code,
            },
          ],
          name: "reuse-session",
        }),
    })
    const session = await Instance.provide({
      directory: project.worktree,
      fn: () =>
        Session.createNext({
          directory: workspace.directory,
          title: "Build Session",
          workspaceID: workspace.id,
          workspaceDirectory: workspace.directory,
          workspaceKind: workspace.kind,
          workspaceStatus: "ready",
          workspaceCleanupStatus: "none",
        }),
    })

    const createNext = spyOn(Session, "createNext")
    const prompt = spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      expect(input.sessionID).toBe(session.id)
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      return {
        info: {
          id: "message_build_reuse_session",
          sessionID: session.id,
          parentID: "message_user_reuse_session",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: workspace.directory,
            root: workspace.directory,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_build_reuse_session",
            sessionID: session.id,
            messageID: "message_build_reuse_session",
            type: "text",
            text: "已完成当前会话代码修改",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请在当前 build 会话里修改并打包。",
      product_id: product.item.id,
      solution_id: solution.item.id,
      session_id: session.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    expect(createNext).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalled()

    const stored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get(),
    )
    expect(stored?.session_id).toBe(session.id)
    expect(stored?.workspace_id).toBe(workspace.id)
  })

  test("reuses the same overlay workspace across consecutive build runs in one session", { timeout: 20_000 }, async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "frontend")

    const product = await AccountProductService.create({
      name: "连续构建产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "连续构建方案",
      code: "reuse-overlay",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "连续构建方案",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const project = await Project.get(product.item.project_id!)
    expect(project).toBeTruthy()
    if (!project) return

    const session = await Instance.provide({
      directory: project.worktree,
      fn: () =>
        Session.createNext({
          directory: repo,
          title: "Build Session",
        }),
    })
    const createOverlay = spyOn(Workspace, "createOverlay")
    const prompt = spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      const current = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get())
      return {
        info: {
          id: `message_${input.sessionID}`,
          sessionID: input.sessionID,
          parentID: `user_${input.sessionID}`,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: current?.directory ?? repo,
            root: current?.directory ?? repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: `part_${input.sessionID}`,
            sessionID: input.sessionID,
            messageID: `message_${input.sessionID}`,
            type: "text",
            text: "已在当前会话继续完成本轮构建修改",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const first = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "第一轮构建",
      product_id: product.item.id,
      solution_id: solution.item.id,
      session_id: session.id,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstRun = await BuildJobService.run(first.job.id)
    expect(firstRun.ok).toBe(true)
    if (!firstRun.ok) return

    const second = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "第二轮构建",
      product_id: product.item.id,
      solution_id: solution.item.id,
      session_id: session.id,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const secondRun = await BuildJobService.run(second.job.id)
    expect(secondRun.ok).toBe(true)
    if (!secondRun.ok) return

    const firstStored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, first.job.id)).get(),
    )
    const secondStored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, second.job.id)).get(),
    )
    const sessionRow = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get())

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(createOverlay).toHaveBeenCalledTimes(1)
    expect(firstStored?.workspace_id).toBeTruthy()
    expect(secondStored?.workspace_id).toBe(firstStored?.workspace_id)
    expect(sessionRow?.workspace_id).toBe(firstStored?.workspace_id)
    expect(sessionRow?.directory).toBe(sessionRow?.workspace_directory)
    expect(sessionRow?.directory).not.toBe(repo)
  })

  test("coding 超时但已经产生真实改动时，会继续进入编译并保留友好提示", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "timeout-build")
    const suffix = Date.now().toString(36)

    const product = await AccountProductService.create({
      name: `改码超时产品-${suffix}`,
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "超时方案",
      code: `timeout-solution-${suffix}`,
      build_profile: {
        workdirs: ["timeout-build"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "超时方案",
          mount_name: "timeout-build",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await insertCompletedEdit({
        session_id: input.sessionID,
        file: "timeout-build/source.txt",
        before: "timeout-build\n",
        after: `changed:${input.sessionID}\n`,
      })
      return await new Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>(() => {})
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请直接修改代码，不要卡住。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id, { coding_timeout_ms: 20 })
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get(),
    )
    expect(stored?.status).toBe("completed")
    expect(stored?.error_code ?? null).toBe(null)

    const detail = await BuildJobService.get(job.job.id)
    const coding = detail?.stages.find((item) => item.stage === "coding")
    expect(coding?.status).toBe("completed")
    expect(coding?.detail_json?.change_count).toBe(1)
    expect(Array.isArray(coding?.detail_json?.recent_activity)).toBe(true)
    expect(Array.isArray(coding?.detail_json?.changes)).toBe(true)
    expect(coding?.detail_json?.timed_out).toBe(true)
  })

  test("coding 超时恢复时会采用最后一次已完成的 edit 结果继续编译", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "timeout-build-latest")
    const suffix = Date.now().toString(36)

    const product = await AccountProductService.create({
      name: `改码超时最新结果产品-${suffix}`,
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "超时最新结果方案",
      code: `timeout-latest-solution-${suffix}`,
      build_profile: {
        workdirs: ["timeout-build-latest"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "超时最新结果方案",
          mount_name: "timeout-build-latest",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      const now = Date.now()
      await insertCompletedEdit({
        session_id: input.sessionID,
        file: "timeout-build-latest/source.txt",
        before: "timeout-build-latest\n",
        after: "changed:first\n",
        suffix: "_first",
        time_created: now,
      })
      await insertCompletedEdit({
        session_id: input.sessionID,
        file: "timeout-build-latest/source.txt",
        before: "changed:first\n",
        after: "changed:latest\n",
        suffix: "_latest",
        time_created: now + 1,
      })
      return await new Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>(() => {})
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请直接修改代码，不要卡住。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id, { coding_timeout_ms: 20 })
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )
    expect(artifacts).toHaveLength(1)

    await using extract = await tmpdir()
    const { Archive } = await import("../../src/util/archive")
    await Archive.extractZip(artifacts[0]!.file_path, extract.path)
    expect(await Bun.file(path.join(extract.path, "timeout-build-latest", "dist", "app.txt")).text()).toBe("changed:latest\n")
  })

  test("会自动接管陈旧的 coding 任务并继续完成编译打包", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "stale-coding")

    const product = await AccountProductService.create({
      name: "陈旧改码恢复产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "陈旧改码恢复方案",
      code: "stale-coding-solution",
      build_profile: {
        workdirs: ["stale-coding"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "陈旧改码恢复方案",
          mount_name: "stale-coding",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改 source.txt 并继续编译打包。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const project = await Project.get(product.item.project_id!)
    expect(project).toBeTruthy()
    if (!project) return

    const workspace = await Instance.provide({
      directory: project.worktree,
      fn: () =>
        Workspace.createOverlay({
          projectID: project.id,
          sourceRoots: [repo],
          members: [
            {
              directory: repo,
              name: "stale-coding",
              relative_path: "stale-coding",
              solution_id: solution.item.id,
              solution_code: solution.item.code,
            },
          ],
          name: `stale-resume-${job.job.id}`,
        }),
    })
    const session = await Instance.provide({
      directory: project.worktree,
      fn: () =>
        Session.createNext({
          directory: workspace.directory,
          title: `Build Job ${product.item.name}`,
          workspaceID: workspace.id,
          workspaceDirectory: workspace.directory,
          workspaceKind: workspace.kind,
          workspaceStatus: "ready",
          workspaceCleanupStatus: "none",
        }),
    })

    await touchWorkspace(session.id, ["stale-coding/source.txt"])
    await fs.writeFile(path.join(session.workspaceDirectory!, "stale-coding", "source.txt"), "changed:stale\n", "utf-8")
    await insertCompletedEdit({
      session_id: session.id,
      file: "stale-coding/source.txt",
      before: "stale-coding\n",
      after: "changed:stale\n",
    })

    const stale = Date.now() - 600_000
    await Database.use((db) =>
      db
        .update(TpBuildJobTable)
        .set({
          status: "running",
          current_stage: "coding",
          started: true,
          session_id: session.id,
          workspace_id: workspace.id,
          time_updated: stale,
        })
        .where(eq(TpBuildJobTable.id, job.job.id))
        .run(),
    )
    await Database.use((db) =>
      db
        .insert(TpBuildJobStageTable)
        .values([
          {
            id: `plan_${job.job.id}`,
            job_id: job.job.id,
            stage: "plan",
            status: "completed",
            detail_json: {
              plan_content: job.job.plan_content,
            },
            time_created: stale,
            time_updated: stale,
          },
          {
            id: `coding_${job.job.id}`,
            job_id: job.job.id,
            stage: "coding",
            status: "running",
            detail_json: {
              session_id: session.id,
              overlay_root: workspace.directory,
            },
            time_created: stale,
            time_updated: stale,
          },
        ])
        .run(),
    )

    const executed = await BuildJobService.run(job.job.id, { coding_timeout_ms: 20 })
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get(),
    )
    expect(stored?.status).toBe("completed")
    expect(stored?.current_stage).toBe("package")

    const detail = await BuildJobService.get(job.job.id)
    expect(detail?.stages.find((item) => item.stage === "coding")?.status).toBe("completed")
    expect(detail?.stages.find((item) => item.stage === "compile")?.status).toBe("completed")
    expect(detail?.stages.find((item) => item.stage === "package")?.status).toBe("completed")
    expect(detail?.artifacts).toHaveLength(1)
  })

  test("supports product-only builds with UNC solution roots and writes back test files", async () => {
    await using tmp = await tmpdir()
    process.env.TPCODE_SHARED_MOUNT_ROOT = tmp.path
    const share = path.join(tmp.path, "共享", "test_project")
    const aaa = path.join(share, "aaa")
    const bbb = path.join(share, "bbb")
    await fs.mkdir(aaa, { recursive: true })
    await fs.mkdir(bbb, { recursive: true })
    await Bun.write(path.join(aaa, "a.txt"), "")
    await Bun.write(path.join(bbb, "b.txt"), "")

    const product = await AccountProductService.create({
      name: "UNC测试产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solutionA = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "A解决方案",
      code: "unc-solution-a",
      build_profile: {
        workdirs: ["aaa"],
        compile_command: 'cp a.txt "${TPCODE_SHARED_MOUNT_ROOT}/共享/test_project/aaa/a.txt"',
        artifact_include: ["a.txt"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: unc("共享", "test_project", "aaa"),
          display_name: "A目录",
          mount_name: "aaa",
          sort_order: 1,
        },
      ],
    })
    expect(solutionA.ok).toBe(true)
    if (!solutionA.ok) return

    const solutionB = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "B解决方案",
      code: "unc-solution-b",
      build_profile: {
        workdirs: ["bbb"],
        compile_command: 'cp b.txt "${TPCODE_SHARED_MOUNT_ROOT}/共享/test_project/bbb/b.txt"',
        artifact_include: ["b.txt"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: unc("共享", "test_project", "bbb"),
          display_name: "B目录",
          mount_name: "bbb",
          sort_order: 1,
        },
      ],
    })
    expect(solutionB.ok).toBe(true)
    if (!solutionB.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["aaa/a.txt", "bbb/b.txt"])
      const session = await Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
      )
      if (session?.workspace_directory) {
        await fs.writeFile(path.join(session.workspace_directory, "aaa", "a.txt"), "a", "utf-8")
        await fs.writeFile(path.join(session.workspace_directory, "bbb", "b.txt"), "b", "utf-8")
      }
      return {
        info: {
          id: "message_unc_mock",
          sessionID: "session_unc_mock",
          parentID: "message_unc_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: share,
            root: share,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_unc_mock",
            sessionID: "session_unc_mock",
            messageID: "message_unc_mock",
            type: "text",
            text: "1. 在 aaa/a.txt 写入字母 a。2. 在 bbb/b.txt 写入字母 b。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "在 aaa/a.txt 写入 a，在 bbb/b.txt 写入 b，不需要实际编译。",
      product_id: product.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    if (!executed.ok) {
      const detail = await BuildJobService.get(job.job.id)
      throw new Error(`UNC_EXECUTED:${JSON.stringify(executed)} DETAIL:${JSON.stringify(detail)}`)
    }
    expect(executed.ok).toBe(true)

    expect(await Bun.file(path.join(aaa, "a.txt")).text()).toBe("a")
    expect(await Bun.file(path.join(bbb, "b.txt")).text()).toBe("b")
  })

  test("only compiles changed solutions for product-wide builds", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "shared-api")
    const app = await createRepo(tmp.path, "cshis-app")

    const product = await AccountProductService.create({
      name: "整产品按变更编译测试",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const apiSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "共享API",
      code: "shared-api",
      build_profile: {
        workdirs: ["shared-api"],
        compile_command: "sleep 5",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "共享API",
          mount_name: "shared-api",
          sort_order: 1,
        },
      ],
    })
    expect(apiSolution.ok).toBe(true)
    if (!apiSolution.ok) return

    const appSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "CSHIS客户端",
      code: "cshis-app",
      build_profile: {
        workdirs: ["cshis-app"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: app,
          display_name: "CSHIS客户端",
          mount_name: "cshis-app",
          sort_order: 2,
        },
      ],
    })
    expect(appSolution.ok).toBe(true)
    if (!appSolution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["cshis-app/source.txt"])
      return {
        info: {
          id: "message_changed_solution_only",
          sessionID: "session_changed_solution_only",
          parentID: "message_user_changed_solution_only",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: app,
            root: app,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_changed_solution_only",
            sessionID: "session_changed_solution_only",
            messageID: "message_changed_solution_only",
            type: "text",
            text: "已完成客户端改动。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "只修改 CSHIS 客户端登录窗体并编译打包。",
      product_id: product.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id, { compile_command_timeout_ms: 500 })
    if (!executed.ok) {
      const detail = await BuildJobService.get(job.job.id)
      throw new Error(`CHANGED_ONLY_EXECUTED:${JSON.stringify(executed)} DETAIL:${JSON.stringify(detail)}`)
    }
    expect(executed.ok).toBe(true)

    const detail = await BuildJobService.get(job.job.id)
    const compile = detail?.stages.find((item) => item.stage === "compile")
    const compileSolutions = (compile?.detail_json?.solutions as Array<Record<string, unknown>> | undefined) ?? []
    expect(compileSolutions.some((item) => item.solution_code === "cshis-app")).toBe(true)
    const skipped = compileSolutions.find((item) => item.solution_code === "shared-api")
    if (skipped) expect(skipped.status).toBe("skipped")
    expect(detail?.artifacts.map((item) => item.file_name)).toEqual(["cshis-app.zip"])
  })

  test("uses overlay coding workspace and isolated compile sandboxes", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "overlay-frontend")
    await Bun.write(path.join(repo, "keep.txt"), "keep\n")
    await $`git add keep.txt`.cwd(repo).quiet()
    await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${"add keep"}`.cwd(repo).quiet()

    const product = await AccountProductService.create({
      name: "覆盖层产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "覆盖层前端",
      code: "overlay-frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "覆盖层前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      return {
        info: {
          id: "message_overlay_build_mock",
          sessionID: "session_overlay_build_mock",
          parentID: "message_overlay_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_overlay_build_mock",
            sessionID: "session_overlay_build_mock",
            messageID: "message_overlay_build_mock",
            type: "text",
            text: "只改动 source.txt。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "只修改 source.txt，并完成编译打包",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const stages = await Database.use((db) =>
      db.select().from(TpBuildJobStageTable).where(eq(TpBuildJobStageTable.job_id, job.job.id)).all(),
    )
    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )
    const workspaces = await Database.use((db) => db.select().from(WorkspaceTable).all())

    expect(stored?.workspace_id).toBeTruthy()
    expect(stored?.status).toBe("completed")
    expect(workspaces).toHaveLength(1)
    expect(await Bun.file(path.join(stored!.workspace_id ? workspaces[0]!.directory : "", "frontend", "source.txt")).exists()).toBe(true)
    expect(await Bun.file(path.join(workspaces[0]!.directory, "frontend", "keep.txt")).exists()).toBe(false)
    expect(await Bun.file(path.join(repo, "source.txt")).text()).toBe("overlay-frontend\n")

    expect(artifacts).toHaveLength(1)
    await using extract = await tmpdir()
    await BuildJobService // noop for import keepalive
    const { Archive } = await import("../../src/util/archive")
    await Archive.extractZip(artifacts[0]!.file_path, extract.path)
    expect(await Bun.file(path.join(extract.path, "frontend", "dist", "app.txt")).text()).toContain("changed:")

    const compile = stages.find((item) => item.stage === "compile")
    expect(compile?.detail_json).toBeTruthy()
  })

  test("runs build jobs when product directory is empty and anchor project comes from solution roots", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "virtual-build-frontend")

    const product = await AccountProductService.create({
      name: "虚拟构建产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "虚拟构建前端",
      code: "virtual-build-frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "虚拟构建前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      return {
        info: {
          id: "message_virtual_build_mock",
          sessionID: "session_virtual_build_mock",
          parentID: "message_virtual_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_virtual_build_mock",
            sessionID: "session_virtual_build_mock",
            messageID: "message_virtual_build_mock",
            type: "text",
            text: "虚拟产品也能直接完成改码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "虚拟产品执行 build",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    expect(stored?.status).toBe("completed")
  })

  test("runs compile and package for non-git solution roots", async () => {
    await using tmp = await tmpdir()
    const folder = await createFolder(tmp.path, "shared-drop")

    const product = await AccountProductService.create({
      name: "共享目录产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "共享目录方案",
      code: "shared-drop",
      build_profile: {
        workdirs: ["shared-drop"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: folder,
          display_name: "共享目录方案",
          mount_name: "shared-drop",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["shared-drop/source.txt"])
      return {
        info: {
          id: "message_non_git_build_mock",
          sessionID: "session_non_git_build_mock",
          parentID: "message_non_git_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: folder,
            root: folder,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_non_git_build_mock",
            sessionID: "session_non_git_build_mock",
            messageID: "message_non_git_build_mock",
            type: "text",
            text: "仅修改普通共享目录文件。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "修改普通共享目录里的 source.txt，并完成编译打包",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )

    expect(stored?.status).toBe("completed")
    expect(artifacts).toHaveLength(1)
    expect(await Bun.file(path.join(folder, "source.txt")).text()).toBe("shared-drop\n")
  })

  test("runs build jobs with only product context and fills project context from solution anchor", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "product-only-context")

    const product = await AccountProductService.create({
      name: "仅产品上下文构建产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "仅产品上下文构建方案",
      code: "product-only-context",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "仅产品上下文构建方案",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend/source.txt"])
      return {
        info: {
          id: "message_product_only_context_mock",
          sessionID: "session_product_only_context_mock",
          parentID: "message_product_only_context_user_mock",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_product_only_context_mock",
            sessionID: "session_product_only_context_mock",
            messageID: "message_product_only_context_mock",
            type: "text",
            text: "产品上下文链路可以直接完成构建。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "仅产品上下文执行 build",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await AccountCurrent.provide(
      {
        user_id: "user_tp_admin",
        org_id: "org_tp_internal",
        department_id: "dept_tp_rnd",
        context_product_id: product.item.id,
        roles: ["super_admin"],
        permissions: ["role:manage", "agent:use_build"],
      },
      () => BuildJobService.run(job.job.id),
    )
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const session = stored?.session_id
      ? await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, stored.session_id!)).get())
      : undefined
    expect(stored?.status).toBe("completed")
    expect(session?.context_project_id).toBeTruthy()
  })

  test("persists explicit runtime model on build job creation", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "runtime-model-create")

    const product = await AccountProductService.create({
      name: "模型持久化产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "模型持久化方案",
      code: "runtime-model-create",
      build_profile: {
        workdirs: ["runtime-model-create"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "模型持久化方案",
          mount_name: "runtime-model-create",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "使用指定模型执行构建",
      product_id: product.item.id,
      solution_id: solution.item.id,
      runtime_model: {
        providerID: "openai",
        modelID: "gpt-5.2",
      },
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const stored = await Database.use((db) =>
      db
        .select({
          runtime_provider_id: sql<string | null>`runtime_provider_id`,
          runtime_model_id: sql<string | null>`runtime_model_id`,
        })
        .from(TpBuildJobTable)
        .where(eq(TpBuildJobTable.id, job.job.id))
        .get(),
    )

    expect(stored?.runtime_provider_id).toBe("openai")
    expect(stored?.runtime_model_id).toBe("gpt-5.2")
  })

  test("applies explicit runtime model to the generated build session before coding", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "runtime-model-run")

    const product = await AccountProductService.create({
      name: "模型执行产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "模型执行方案",
      code: "runtime-model-run",
      build_profile: {
        workdirs: ["runtime-model-run"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "模型执行方案",
          mount_name: "runtime-model-run",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["runtime-model-run/source.txt"])
      return {
        info: {
          id: "message_runtime_model_run",
          sessionID: "session_runtime_model_run",
          parentID: "message_user_runtime_model_run",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_runtime_model_run",
            sessionID: "session_runtime_model_run",
            messageID: "message_runtime_model_run",
            type: "text",
            text: "已按指定模型完成构建改码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "使用指定模型执行构建",
      product_id: product.item.id,
      solution_id: solution.item.id,
      runtime_model: {
        providerID: "openrouter",
        modelID: "openai/gpt-4o-mini",
      },
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) =>
      db
        .select()
        .from(TpBuildJobTable)
        .where(eq(TpBuildJobTable.id, job.job.id))
        .get(),
    )
    expect(stored?.session_id).toBeTruthy()
    if (!stored?.session_id) return

    const session = await Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, stored.session_id!))
        .get(),
    )

    expect(session?.runtime_provider_id).toBe("openrouter")
    expect(session?.runtime_model_id).toBe("openai/gpt-4o-mini")
  })

  test("runs one product-wide build job across all enabled solutions by default", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "product-wide-frontend")
    const api = await createRepo(tmp.path, "product-wide-api")

    const product = await AccountProductService.create({
      name: "产品级构建",
      directory: frontend,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const frontendSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端方案",
      code: "product-wide-frontend",
      build_profile: {
        workdirs: ["frontend-app"],
        compile_command: "mkdir -p dist && cp source.txt dist/frontend.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端方案",
          mount_name: "frontend-app",
          sort_order: 1,
        },
      ],
    })
    expect(frontendSolution.ok).toBe(true)
    if (!frontendSolution.ok) return

    const apiSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "接口方案",
      code: "product-wide-api",
      build_profile: {
        workdirs: ["shared-api"],
        compile_command: "mkdir -p dist && cp source.txt dist/api.txt",
        artifact_include: ["dist/**"],
        output_name_template: "{{solution}}.zip",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "接口方案",
          mount_name: "shared-api",
          sort_order: 1,
        },
      ],
    })
    expect(apiSolution.ok).toBe(true)
    if (!apiSolution.ok) return

    const prompt = spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["frontend-app/source.txt", "shared-api/source.txt"])
      return {
        info: {
          id: "message_build_product_scope",
          sessionID: "session_build_product_scope",
          parentID: "message_user_product_scope",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: frontend,
            root: frontend,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_build_product_scope",
            sessionID: "session_build_product_scope",
            messageID: "message_build_product_scope",
            type: "text",
            text: "统一完成产品级代码变更。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "同时修改前端和接口，并生成发布包",
      product_id: product.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )

    expect(stored?.status).toBe("completed")
    expect(artifacts).toHaveLength(2)
    expect(artifacts.map((item) => item.solution_id).sort()).toEqual(
      [frontendSolution.item.id, apiSolution.item.id].sort(),
    )
    expect(artifacts.every((item) => item.file_name.endsWith(".zip"))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("includes product-wide build jobs when listing by a bound solution filter", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "list-filter-frontend")
    const api = await createRepo(tmp.path, "list-filter-api")

    const product = await AccountProductService.create({
      name: "列表筛选产品",
      directory: frontend,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const frontendSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "列表筛选前端",
      code: "list-filter-frontend",
      build_profile: {
        workdirs: ["frontend-app"],
        compile_command: "mkdir -p dist && cp source.txt dist/frontend.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "列表筛选前端",
          mount_name: "frontend-app",
          sort_order: 1,
        },
      ],
    })
    expect(frontendSolution.ok).toBe(true)
    if (!frontendSolution.ok) return

    const apiSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "列表筛选接口",
      code: "list-filter-api",
      build_profile: {
        workdirs: ["shared-api"],
        compile_command: "mkdir -p dist && cp source.txt dist/api.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "列表筛选接口",
          mount_name: "shared-api",
          sort_order: 1,
        },
      ],
    })
    expect(apiSolution.ok).toBe(true)
    if (!apiSolution.ok) return

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "列表筛选测试",
      product_id: product.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const listed = await BuildJobService.list({
      product_id: product.item.id,
      solution_id: apiSolution.item.id,
    })

    expect(listed.map((item) => item.id)).toContain(job.job.id)
  })

  test("fails coding stage when assistant only replies text without real file changes", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "coding-no-change")

    const product = await AccountProductService.create({
      name: "未改码产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "未改码方案",
      code: "coding-no-change",
      build_profile: {
        workdirs: ["coding-no-change"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "未改码方案",
          mount_name: "coding-no-change",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async () => {
      return {
        info: {
          id: "message_coding_no_change",
          sessionID: "session_coding_no_change",
          parentID: "message_user_coding_no_change",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_coding_no_change",
            sessionID: "session_coding_no_change",
            messageID: "message_coding_no_change",
            type: "text",
            text: "我已经修改完成。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("coding_no_changes")

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const coding = await Database.use((db) =>
      db
        .select()
        .from(TpBuildJobStageTable)
        .where(eq(TpBuildJobStageTable.job_id, job.job.id))
        .all(),
    )

    expect(stored?.status).toBe("failed")
    expect(stored?.current_stage).toBe("coding")
    expect(coding.find((item) => item.stage === "coding")?.status).toBe("failed")
  })

  test("fails compile stage when configured workdir is missing from workspace", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "compile-missing-workdir")
    const extra = await createRepo(tmp.path, "compile-missing-workdir-extra")

    const product = await AccountProductService.create({
      name: "编译目录错误产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "编译目录错误方案",
      code: "compile-missing-workdir",
      build_profile: {
        workdirs: ["Y:\\01电子病历-统一版"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "编译目录错误方案",
          mount_name: "compile-missing-workdir",
          sort_order: 1,
        },
        {
          root_type: "single_repo",
          directory: extra,
          display_name: "编译目录错误附加方案",
          mount_name: "compile-missing-workdir-extra",
          sort_order: 2,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["compile-missing-workdir/source.txt"])
      return {
        info: {
          id: "message_compile_missing_workdir",
          sessionID: "session_compile_missing_workdir",
          parentID: "message_user_compile_missing_workdir",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_compile_missing_workdir",
            sessionID: "session_compile_missing_workdir",
            messageID: "message_compile_missing_workdir",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并编译",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("build_workdir_missing")
  })

  test("fails compile stage when compile command is still the default placeholder", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "compile-placeholder")

    const product = await AccountProductService.create({
      name: "编译占位产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "编译占位方案",
      code: "compile-placeholder",
      build_profile: {
        workdirs: ["compile-placeholder"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "编译占位方案",
          mount_name: "compile-placeholder",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["compile-placeholder/source.txt"])
      return {
        info: {
          id: "message_compile_placeholder",
          sessionID: "session_compile_placeholder",
          parentID: "message_user_compile_placeholder",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_compile_placeholder",
            sessionID: "session_compile_placeholder",
            messageID: "message_compile_placeholder",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并编译",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("compile_command_unconfigured")
  })

  test("fails compile stage with a timeout and keeps friendly compile context", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "compile-timeout")

    const product = await AccountProductService.create({
      name: "编译超时产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "编译超时方案",
      code: "compile-timeout",
      build_profile: {
        workdirs: ["compile-timeout"],
        compile_command: "sleep 5",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "编译超时方案",
          mount_name: "compile-timeout",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["compile-timeout/source.txt"])
      return {
        info: {
          id: "message_compile_timeout",
          sessionID: "session_compile_timeout",
          parentID: "message_user_compile_timeout",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_compile_timeout",
            sessionID: "session_compile_timeout",
            messageID: "message_compile_timeout",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并编译。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id, { compile_command_timeout_ms: 20 })
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("compile_timeout")

    const detail = await BuildJobService.get(job.job.id)
    const compile = detail?.stages.find((item) => item.stage === "compile")
    expect(compile?.error_code).toBe("compile_timeout")
    expect((compile?.detail_json?.solutions as Array<Record<string, unknown>>)?.[0]?.command).toBe("sleep 5")
    expect((compile?.detail_json?.solutions as Array<Record<string, unknown>>)?.[0]?.cwd).toContain("compile-timeout")
  })

  test("fails compile stage when compile sandbox preparation hangs", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "compile-sandbox-timeout")

    const product = await AccountProductService.create({
      name: "编译沙盒超时产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "编译沙盒超时方案",
      code: "compile-sandbox-timeout",
      build_profile: {
        workdirs: ["compile-sandbox-timeout"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "编译沙盒超时方案",
          mount_name: "compile-sandbox-timeout",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["compile-sandbox-timeout/source.txt"])
      return {
        info: {
          id: "message_compile_sandbox_timeout",
          sessionID: "session_compile_sandbox_timeout",
          parentID: "message_user_compile_sandbox_timeout",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_compile_sandbox_timeout",
            sessionID: "session_compile_sandbox_timeout",
            messageID: "message_compile_sandbox_timeout",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    spyOn(BuildCompileSandbox, "create").mockImplementation(
      async () => await new Promise<never>(() => {}),
    )

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并编译。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id, { compile_prepare_timeout_ms: 20 })
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("compile_sandbox_timeout")

    const detail = await BuildJobService.get(job.job.id)
    const compile = detail?.stages.find((item) => item.stage === "compile")
    expect(compile?.error_code).toBe("compile_sandbox_timeout")
    expect((compile?.detail_json?.solutions as Array<Record<string, unknown>>)?.[0]?.requested_workdirs).toEqual(["compile-sandbox-timeout"])
  })

  test("treats saved plans as confirmed instructions and continues coding without asking follow-up questions", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "saved-plan-confirmed")

    const product = await AccountProductService.create({
      name: "已保存计划执行产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "已保存计划执行方案",
      code: "saved-plan-confirmed",
      build_profile: {
        workdirs: ["saved-plan-confirmed"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "已保存计划执行方案",
          mount_name: "saved-plan-confirmed",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const saved_plan_id = await savePlan({
      product_id: product.item.id,
      project_id: product.item.project_id || "",
      project_worktree: repo,
      session_title: "保存计划后执行",
      plan_content:
        "步骤 1：在登录页增加一句提示文案。步骤 2：提示文案可参考“测试环境，请勿录入真实数据”。需要确认最终文案后再实施。",
    })

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      const part = input.parts.find((item) => item.type === "text")
      const text = part?.type === "text" ? part.text : ""
      if (text.includes("不要重复输出计划") && text.includes("禁止继续向用户提问")) {
        await touchWorkspace(input.sessionID, ["saved-plan-confirmed/source.txt"])
      }
      return {
        info: {
          id: "message_saved_plan_confirmed",
          sessionID: "session_saved_plan_confirmed",
          parentID: "message_saved_plan_confirmed_user",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_saved_plan_confirmed",
            sessionID: "session_saved_plan_confirmed",
            messageID: "message_saved_plan_confirmed",
            type: "text",
            text: "按保存计划已完成代码修改。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "saved_plan",
      saved_plan_id,
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
  })

  test("adds .NET stack and candidate file hints to saved plan coding prompts", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "saved-plan-dotnet-hint")
    await fs.mkdir(path.join(repo, "App"), { recursive: true })
    await Bun.write(path.join(repo, "App", "App.csproj"), "<Project />")
    await Bun.write(path.join(repo, "App", "frmLogin.cs"), "class FrmLogin {}")

    const product = await AccountProductService.create({
      name: "已保存计划提示增强产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "已保存计划提示增强方案",
      code: "saved-plan-dotnet-hint",
      build_profile: {
        workdirs: ["saved-plan-dotnet-hint"],
        compile_command: "printf '.\\\\App\\\\App.csproj' >/dev/null && mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "已保存计划提示增强方案",
          mount_name: "saved-plan-dotnet-hint",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const saved_plan_id = await savePlan({
      product_id: product.item.id,
      project_id: product.item.project_id || "",
      project_worktree: repo,
      session_title: "登录页提示增强",
      plan_content: "请在登录页增加测试提示文案，不要反问。",
    })

    let captured = ""
    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      const part = input.parts.find((item) => item.type === "text")
      captured = part?.type === "text" ? part.text : ""
      await touchWorkspace(input.sessionID, ["saved-plan-dotnet-hint/source.txt"])
      return {
        info: {
          id: "message_saved_plan_hint",
          sessionID: "session_saved_plan_hint",
          parentID: "message_saved_plan_hint_user",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_saved_plan_hint",
            sessionID: "session_saved_plan_hint",
            messageID: "message_saved_plan_hint",
            type: "text",
            text: "已完成代码修改。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "saved_plan",
      saved_plan_id,
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    expect(captured).toContain("技术栈：.NET/C#")
    expect(captured).toContain("App/App.csproj")
    expect(captured).toContain("frmLogin.cs")
  })

  test("falls back to the single mounted solution directory when configured workdir is invalid", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "workdir-fallback")

    const product = await AccountProductService.create({
      name: "工作目录回退产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "工作目录回退方案",
      code: "workdir-fallback",
      build_profile: {
        workdirs: ["安统一HISAPI服务"],
        compile_command: "mkdir -p dist && cp source.txt dist/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "统一HISAPI服务",
          mount_name: "统一HISAPI服务",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["统一HISAPI服务/source.txt"])
      return {
        info: {
          id: "message_workdir_fallback",
          sessionID: "session_workdir_fallback",
          parentID: "message_workdir_fallback_user",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_workdir_fallback",
            sessionID: "session_workdir_fallback",
            messageID: "message_workdir_fallback",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并完成编译打包",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
  })

  test("falls back to .ai__build outputs when configured artifact patterns match nothing", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "artifact-fallback")

    const product = await AccountProductService.create({
      name: "产物回退产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "产物回退方案",
      code: "artifact-fallback",
      build_profile: {
        workdirs: ["artifact-fallback"],
        compile_command: "mkdir -p .ai__build && cp source.txt .ai__build/app.txt",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "产物回退方案",
          mount_name: "artifact-fallback",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["artifact-fallback/source.txt"])
      return {
        info: {
          id: "message_artifact_fallback",
          sessionID: "session_artifact_fallback",
          parentID: "message_artifact_fallback_user",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_artifact_fallback",
            sessionID: "session_artifact_fallback",
            messageID: "message_artifact_fallback",
            type: "text",
            text: "已修改代码。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并完成编译打包",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })

    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )
    expect(artifacts.length).toBe(1)
    expect(await Bun.file(artifacts[0]!.file_path).exists()).toBe(true)
  })

  test("reuses existing running saved-plan build job instead of creating duplicates", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "dedupe-build")

    const product = await AccountProductService.create({
      name: "计划去重产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "计划去重方案",
      code: "dedupe-build",
      build_profile: {
        workdirs: ["dedupe-build"],
        compile_command: "mkdir -p .ai__build && cp source.txt .ai__build/app.txt",
        artifact_include: [".ai__build/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "计划去重方案",
          mount_name: "dedupe-build",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const plan_id = await savePlan({
      product_id: product.item.id,
      project_id: product.item.project_id ?? product.item.id,
      project_worktree: repo,
      session_title: "计划去重",
      plan_content: "请修改 source.txt 并完成构建。",
    })

    const first = await BuildJobService.create({
      source_type: "saved_plan",
      product_id: product.item.id,
      saved_plan_id: plan_id,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await Database.use((db) =>
      db
        .update(TpBuildJobTable)
        .set({
          status: "running",
          started: true,
          time_updated: Date.now(),
        })
        .where(eq(TpBuildJobTable.id, first.job.id))
        .run(),
    )

    const second = await BuildJobService.create({
      source_type: "saved_plan",
      product_id: product.item.id,
      saved_plan_id: plan_id,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.job.id).toBe(first.job.id)
    expect(second.reused).toBe(true)

    const jobs = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.product_id, product.item.id)).all(),
    )
    expect(jobs).toHaveLength(1)
  })

  test("reports windows-only compile commands with a friendly platform error on non-windows nodes", async () => {
    if (process.platform === "win32") return
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "windows-compile")

    const product = await AccountProductService.create({
      name: "Windows编译产品",
      directory: repo,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "Windows编译方案",
      code: "windows-compile",
      build_profile: {
        workdirs: ["windows-compile"],
        compile_command:
          '$msbuild = "D:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Community\\\\MSBuild\\\\Current\\\\Bin\\\\MSBuild.exe"; & $msbuild ".\\\\demo.sln" /t:Build',
        artifact_include: [".ai__build/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: repo,
          display_name: "Windows编译方案",
          mount_name: "windows-compile",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    spyOn(
      SessionPrompt as {
        prompt: (...args: never[]) => Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>>
      },
      "prompt",
    ).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as Parameters<typeof SessionPrompt.prompt>[0]
      await touchWorkspace(input.sessionID, ["windows-compile/source.txt"])
      return {
        info: {
          id: "message_windows_compile",
          sessionID: "session_windows_compile",
          parentID: "message_windows_compile_user",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          providerID: "openai",
          modelID: "gpt-5.2",
          mode: "build",
          path: {
            cwd: repo,
            root: repo,
          },
          agent: "build",
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [
          {
            id: "part_windows_compile",
            sessionID: "session_windows_compile",
            messageID: "message_windows_compile",
            type: "text",
            text: "已完成代码修改。",
          },
        ],
      } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const job = await BuildJobService.create({
      source_type: "prompt",
      prompt_text: "请修改代码并完成编译。",
      product_id: product.item.id,
      solution_id: solution.item.id,
    })
    expect(job.ok).toBe(true)
    if (!job.ok) return

    const executed = await BuildJobService.run(job.job.id)
    expect(executed.ok).toBe(false)
    if (executed.ok) return
    expect(executed.code).toBe("compile_platform_unsupported")

    const stored = await Database.use((db) =>
      db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get(),
    )
    const compile = await Database.use((db) =>
      db
        .select()
        .from(TpBuildJobStageTable)
        .where(eq(TpBuildJobStageTable.job_id, job.job.id))
        .all(),
    )
    expect(stored?.status).toBe("failed")
    expect(stored?.error_code).toBe("compile_platform_unsupported")
    expect(stored?.error_message).toContain("Windows")
    expect(compile.find((item) => item.stage === "compile")?.error_code).toBe("compile_platform_unsupported")
  })
})
