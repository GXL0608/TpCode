import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Workspace } from "../../src/control-plane/workspace"
import { BuildOverlay } from "../../src/build/overlay"
import { AccountCurrent } from "../../src/user/current"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionBindingTable } from "../../src/user/product-solution-binding.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建最小 Git 仓库，供产品会话自动聚合工作区测试复用。 */
async function repo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "index.txt"), `${name}\n`)
  await $`git add index.txt`.cwd(directory).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

describe("product session workspace", () => {
  afterEach(async () => {
    await Database.use(async (db) => {
      await db.delete(SessionTable).run()
      await db.delete(WorkspaceTable).run()
      await db.delete(TpProductSolutionRootTable).run()
      await db.delete(TpProductSolutionBindingTable).run()
      await db.delete(TpProductSolutionTable).run()
      await db.delete(TpProductTable).run()
    })
  })

  test("creates ordinary product sessions inside aggregated solution overlay workspace", async () => {
    await using tmp = await tmpdir()
    const anchor = await repo(tmp.path, "emr-main")
    const api = await repo(tmp.path, "emr-api")

    const product = await AccountProductService.create({
      name: "电子病历-测试",
      directory: anchor,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const frontend = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端方案",
      code: "emr-main",
      build_profile: {
        workdirs: ["emr-main"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: anchor,
          mount_name: "emr-main",
        },
      ],
    })
    expect(frontend.ok).toBe(true)
    if (!frontend.ok) return

    const backend = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "接口方案",
      code: "emr-api",
      build_profile: {
        workdirs: ["emr-api"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          mount_name: "emr-api",
        },
      ],
    })
    expect(backend.ok).toBe(true)
    if (!backend.ok) return

    const session = await Instance.provide({
      directory: anchor,
      fn: () =>
        AccountCurrent.provide(
          {
            user_id: "user_session_product",
            org_id: "org_session_product",
            context_project_id: product.item.project_id,
            context_product_id: product.item.id,
            roles: [],
            permissions: [],
          },
          () => Session.create({ title: "电子病历普通会话" }),
        ),
    })

    expect(session.workspaceID).toBeTruthy()
    expect(session.workspaceKind).toBe("batch_worktree")
    expect(session.directory).not.toBe(anchor)

    const workspace = await Workspace.get(session.workspaceID!)
    expect(workspace?.directory).toBe(session.directory)
    expect(workspace?.meta?.overlay?.mounts.map((item) => item.mount_name).sort()).toEqual(["emr-api", "emr-main"])
    const project_row = await Project.get(product.item.project_id)
    expect(project_row?.sandboxes.some((item) => item === session.directory)).toBe(false)

    const overlay = await BuildOverlay.load(session.id)
    expect(overlay).toBeTruthy()
    if (!overlay) return
    expect(await BuildOverlay.listDirectory({ overlay, directory: session.directory })).toEqual(["emr-api/", "emr-main/"])
  }, 20_000)

  test("creates unique overlay mount names when multiple solutions share the same display name", async () => {
    await using tmp = await tmpdir()
    const frontend = await repo(tmp.path, "frontend")
    const backend = await repo(tmp.path, "backend")

    const product = await AccountProductService.create({
      name: "慢病管理系统-测试",
      directory: frontend,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const frontendSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "慢病系统前端",
      code: "frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "慢病系统",
          mount_name: "慢病系统",
        },
      ],
    })
    expect(frontendSolution.ok).toBe(true)
    if (!frontendSolution.ok) return

    const backendSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "慢病系统后端",
      code: "backend",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "慢病系统",
          mount_name: "慢病系统",
        },
      ],
    })
    expect(backendSolution.ok).toBe(true)
    if (!backendSolution.ok) return

    const session = await Instance.provide({
      directory: frontend,
      fn: () =>
        AccountCurrent.provide(
          {
            user_id: "user_session_product_duplicate",
            org_id: "org_session_product_duplicate",
            context_project_id: product.item.project_id,
            context_product_id: product.item.id,
            roles: [],
            permissions: [],
          },
          () => Session.create({ title: "慢病管理系统普通会话" }),
        ),
    })

    const workspace = await Workspace.get(session.workspaceID!)
    const mount_names = workspace?.meta?.overlay?.mounts.map((item) => item.mount_name) ?? []
    expect(mount_names).toHaveLength(2)
    expect(new Set(mount_names).size).toBe(2)
    expect(await BuildOverlay.listDirectory({ overlay: workspace!.meta!.overlay!, directory: session.directory })).toHaveLength(2)
  }, 20_000)

  test("reuses the parent overlay workspace for child sessions", async () => {
    await using tmp = await tmpdir()
    const api = await repo(tmp.path, "api")
    const client = await repo(tmp.path, "client")

    const product = await AccountProductService.create({
      name: "CSHIS-子会话测试",
      directory: api,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const backend = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "后端方案",
      code: "api",
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          mount_name: "api",
        },
      ],
    })
    expect(backend.ok).toBe(true)
    if (!backend.ok) return

    const frontend = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端方案",
      code: "client",
      build_profile: {
        workdirs: ["client"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: client,
          mount_name: "client",
        },
      ],
    })
    expect(frontend.ok).toBe(true)
    if (!frontend.ok) return

    const result = await Instance.provide({
      directory: api,
      fn: () =>
        AccountCurrent.provide(
          {
            user_id: "user_session_product_child",
            org_id: "org_session_product_child",
            context_project_id: product.item.project_id,
            context_product_id: product.item.id,
            roles: [],
            permissions: [],
          },
          async () => {
            const parent = await Session.create({ title: "父会话" })
            const child = await Session.create({ parentID: parent.id, title: "子会话" })
            return { parent, child }
          },
        ),
    })

    expect(result.parent.workspaceID).toBeTruthy()
    expect(result.child.workspaceID).toBe(result.parent.workspaceID)
    expect(result.child.directory).toBe(result.parent.directory)

    const overlay = await BuildOverlay.load(result.child.id)
    expect(overlay).toBeTruthy()
    if (!overlay) return
    expect(await BuildOverlay.listDirectory({ overlay, directory: result.child.directory })).toEqual(["api/", "client/"])
  }, 20_000)

  test("falls back to the current directory when restored product roots are unavailable on this machine", async () => {
    await using tmp = await tmpdir()
    const anchor = await repo(tmp.path, "local-anchor")

    const product = await AccountProductService.create({
      name: "不可访问产品-测试",
      directory: anchor,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "共享后端",
      code: "unavailable-backend",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: anchor,
          mount_name: "backend",
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const missing = path.join(tmp.path, "missing-backend")
    await Database.use((db) =>
      db
        .update(TpProductSolutionRootTable)
        .set({
          directory: missing,
          time_updated: Date.now(),
        })
        .where(eq(TpProductSolutionRootTable.solution_id, solution.item.id))
        .run(),
    )

    const session = await Instance.provide({
      directory: anchor,
      fn: () =>
        AccountCurrent.provide(
          {
            user_id: "user_session_product_missing",
            org_id: "org_session_product_missing",
            context_project_id: product.item.project_id,
            context_product_id: product.item.id,
            roles: [],
            permissions: [],
          },
          () => Session.create({ title: "不可访问产品普通会话" }),
        ),
    })

    expect(session.directory).toBe(anchor)
    expect(session.workspaceID).toBeUndefined()
    expect(await Workspace.getByDirectory(anchor)).toBeUndefined()
  }, 20_000)

  test("isolates product sessions by context_product_id even when solutions share the same project roots", async () => {
    await using tmp = await tmpdir()
    const backend = await repo(tmp.path, "backend")
    const frontend = await repo(tmp.path, "frontend")

    const productA = await AccountProductService.create({
      name: "慢病管理系统-A",
      directory: backend,
    })
    expect(productA.ok).toBe(true)
    if (!productA.ok) return

    const productB = await AccountProductService.create({
      name: "慢病管理系统-B",
      directory: "",
    })
    expect(productB.ok).toBe(true)
    if (!productB.ok) return

    const backendSolution = await ProductSolutionService.create({
      product_id: productA.item.id,
      name: "后端",
      code: "backend-shared",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          mount_name: "backend",
        },
      ],
    })
    expect(backendSolution.ok).toBe(true)
    if (!backendSolution.ok) return

    const frontendSolution = await ProductSolutionService.create({
      product_id: productA.item.id,
      name: "前端",
      code: "frontend-shared",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          mount_name: "frontend",
        },
      ],
    })
    expect(frontendSolution.ok).toBe(true)
    if (!frontendSolution.ok) return

    await Database.use((db) =>
      db.insert(TpProductSolutionBindingTable)
        .values([
          {
            id: crypto.randomUUID(),
            product_id: productA.item.id,
            solution_id: backendSolution.item.id,
            enabled: true,
            sort_order: 1,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            product_id: productA.item.id,
            solution_id: frontendSolution.item.id,
            enabled: true,
            sort_order: 2,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            product_id: productB.item.id,
            solution_id: backendSolution.item.id,
            enabled: true,
            sort_order: 1,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            product_id: productB.item.id,
            solution_id: frontendSolution.item.id,
            enabled: true,
            sort_order: 2,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        ])
        .onConflictDoNothing()
        .run(),
    )

    const created = await Instance.provide({
      directory: backend,
      fn: async () => {
        const a = await AccountCurrent.provide(
          {
            user_id: "user_product_a",
            org_id: "org_product",
            context_project_id: productA.item.project_id,
            context_product_id: productA.item.id,
            roles: [],
            permissions: [],
          },
          () => Session.create({ title: "产品A会话" }),
        )
        const b = await AccountCurrent.provide(
          {
            user_id: "user_product_a",
            org_id: "org_product",
            context_project_id: backendSolution.item.primary_project_id,
            context_product_id: productB.item.id,
            roles: [],
            permissions: [],
          },
          () => Session.create({ title: "产品B会话" }),
        )
        return { a, b }
      },
    })

    const rows = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.user_id, "user_product_a")).all())
    const rowA = rows.find((item) => item.id === created.a.id)
    const rowB = rows.find((item) => item.id === created.b.id)
    expect(rowA?.context_product_id).toBe(productA.item.id)
    expect(rowB?.context_product_id).toBe(productB.item.id)

    const listedA = await Instance.provide({
      directory: backend,
      fn: () =>
        AccountCurrent.provide(
          {
            user_id: "user_product_a",
            org_id: "org_product",
            context_project_id: backendSolution.item.primary_project_id,
            context_product_id: productA.item.id,
            roles: [],
            permissions: [],
          },
          async () => {
            const list = [] as string[]
            for await (const item of Session.listGlobal()) {
              list.push(item.id)
            }
            return list
          },
        ),
    })
    expect(listedA).toEqual([created.a.id])
  }, 20_000)
})
