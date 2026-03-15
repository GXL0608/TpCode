import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Database, eq } from "../../src/storage/db"
import { TpBuildArtifactTable } from "../../src/build/artifact.sql"
import { TpBuildJobTable } from "../../src/build/job.sql"
import { TpBuildJobStageTable } from "../../src/build/job-stage.sql"
import { BuildJobService } from "../../src/build/service"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
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
          display_name: "frontend",
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
    ).mockImplementation(async () => {
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
})
