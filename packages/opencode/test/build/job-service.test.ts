import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Database, eq, sql } from "../../src/storage/db"
import { TpBuildArtifactTable } from "../../src/build/artifact.sql"
import { TpBuildJobTable } from "../../src/build/job.sql"
import { TpBuildJobStageTable } from "../../src/build/job-stage.sql"
import { BuildJobService } from "../../src/build/service"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { SessionTable } from "../../src/session/session.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { SessionPrompt } from "../../src/session/prompt"
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

describe("build job service", () => {
  afterEach(async () => {
    mock.restore()
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

    const stored = await Database.use((db) => db.select().from(TpBuildJobTable).where(eq(TpBuildJobTable.id, job.job.id)).get())
    const stages = await Database.use((db) =>
      db.select().from(TpBuildJobStageTable).where(eq(TpBuildJobStageTable.job_id, job.job.id)).all(),
    )
    const artifacts = await Database.use((db) =>
      db.select().from(TpBuildArtifactTable).where(eq(TpBuildArtifactTable.job_id, job.job.id)).all(),
    )

    expect(stored?.status).toBe("completed")
    expect(stages.map((item) => item.stage)).toEqual(["plan", "coding", "compile", "package"])
    expect(artifacts).toHaveLength(1)
    expect(await Bun.file(artifacts[0]!.file_path).exists()).toBe(true)
    expect(artifacts[0]!.file_name.endsWith(".zip")).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
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
})
