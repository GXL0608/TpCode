import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Project } from "../../src/project/project"
import { anchorBySolutions, ensureProjectByDirectory, invalidateProductAnchorCache, projectIDsBySolutions } from "../../src/user/product-anchor"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建最小 Git 仓库，供产品锚点缓存测试复用。 */
async function createRepo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

describe("product anchor", () => {
  afterEach(() => {
    invalidateProductAnchorCache()
    mock.restore()
  })

  test("reuses cached project anchors for repeated directory lookups", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "anchor-cache-repo")
    const fromDirectory = spyOn(Project, "fromDirectory")

    const first = await ensureProjectByDirectory(repo)
    const second = await ensureProjectByDirectory(repo)

    expect(first?.id).toBeTruthy()
    expect(second?.id).toBe(first?.id)
    expect(fromDirectory).toHaveBeenCalledTimes(1)
  })

  test("dedupes concurrent directory lookups while the first project probe is still running", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "anchor-pending-repo")
    const original = Project.fromDirectory
    const fromDirectory = spyOn(Project, "fromDirectory").mockImplementation(async (directory) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return original(directory)
    })

    const [first, second, third] = await Promise.all([
      ensureProjectByDirectory(repo),
      ensureProjectByDirectory(repo),
      ensureProjectByDirectory(repo),
    ])

    expect(first?.id).toBeTruthy()
    expect(second?.id).toBe(first?.id)
    expect(third?.id).toBe(first?.id)
    expect(fromDirectory).toHaveBeenCalledTimes(1)
  })

  test("prefers root-derived product anchor over stale primary project id", async () => {
    await using tmp = await tmpdir()
    const stale = await createRepo(tmp.path, "stale-anchor")
    const frontend = await createRepo(tmp.path, "frontend-anchor")
    const staleProject = await ensureProjectByDirectory(stale)

    expect(staleProject?.id).toBeTruthy()

    const anchor = await anchorBySolutions([
      {
        id: "solution_frontend",
        product_id: "product_virtual",
        name: "前端方案",
        code: "frontend",
        enabled: true,
        build_profile: {
          workdirs: ["frontend"],
          compile_command: "echo build",
          package_mode: "zip",
          artifact_include: ["dist/**"],
          artifact_exclude: [],
          output_name_template: "{{solution}}.zip",
        },
        roots: [
          {
            id: "root_frontend",
            solution_id: "solution_frontend",
            root_type: "single_repo",
            directory: frontend,
            display_name: "前端",
            mount_name: "frontend",
            sort_order: 0,
            enabled: true,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        ],
        time_created: Date.now(),
        time_updated: Date.now(),
      },
    ])

    expect(anchor?.project_id).not.toBe(staleProject?.id)
    expect(anchor?.worktree).toBe(frontend)
  })

  test("prefers root-derived related project ids over stale primary project ids", async () => {
    await using tmp = await tmpdir()
    const stale = await createRepo(tmp.path, "stale-project")
    const frontend = await createRepo(tmp.path, "frontend-project")
    const backend = await createRepo(tmp.path, "backend-project")
    const staleProject = await ensureProjectByDirectory(stale)
    const frontendProject = await ensureProjectByDirectory(frontend)
    const backendProject = await ensureProjectByDirectory(backend)

    expect(staleProject?.id).toBeTruthy()
    expect(frontendProject?.id).toBeTruthy()
    expect(backendProject?.id).toBeTruthy()

    const ids = await projectIDsBySolutions([
      {
        id: "solution_frontend",
        product_id: "product_a",
        name: "前端方案",
        code: "frontend",
        enabled: true,
        build_profile: {
          workdirs: ["frontend"],
          compile_command: "echo build",
          package_mode: "zip",
          artifact_include: ["dist/**"],
          artifact_exclude: [],
          output_name_template: "{{solution}}.zip",
        },
        roots: [
          {
            id: "root_frontend",
            solution_id: "solution_frontend",
            root_type: "single_repo",
            directory: frontend,
            display_name: "前端",
            mount_name: "frontend",
            sort_order: 0,
            enabled: true,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        ],
        time_created: Date.now(),
        time_updated: Date.now(),
      },
      {
        id: "solution_backend",
        product_id: "product_b",
        name: "后端方案",
        code: "backend",
        enabled: true,
        build_profile: {
          workdirs: ["backend"],
          compile_command: "echo build",
          package_mode: "zip",
          artifact_include: ["dist/**"],
          artifact_exclude: [],
          output_name_template: "{{solution}}.zip",
        },
        roots: [
          {
            id: "root_backend",
            solution_id: "solution_backend",
            root_type: "single_repo",
            directory: backend,
            display_name: "后端",
            mount_name: "backend",
            sort_order: 0,
            enabled: true,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        ],
        time_created: Date.now(),
        time_updated: Date.now(),
      },
    ])

    expect(ids).toEqual([frontendProject?.id, backendProject?.id])
  })
})
