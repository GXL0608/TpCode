import { $ } from "bun"
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq, inArray } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"
import { TpRoleProductAccessTable } from "../../src/user/role-product-access.sql"
import { TpRoleTable } from "../../src/user/role.sql"
import { TpProjectUserAccessTable } from "../../src/user/project-user-access.sql"
import { TpProductSolutionBindingTable } from "../../src/user/product-solution-binding.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { AccountContextService } from "../../src/user/context"
import { TpSessionTokenTable } from "../../src/user/token.sql"
import { TpUserProjectStateTable } from "../../src/user/user-project-state.sql"
import { TpUserTable } from "../../src/user/user.sql"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { ensureProjectByDirectory } from "../../src/user/product-anchor"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

/** 中文注释：启动测试服务并预置管理员账号，供产品选择接口回归验证复用。 */
async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App() }
}

const state = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
}

/** 中文注释：统一发送测试请求，减少各个接口用例中的重复代码。 */
async function req(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
}) {
  const app = state.app
  if (!app) throw new Error("app_missing")
  const headers = new Headers()
  if (input.token) headers.set("authorization", `Bearer ${input.token}`)
  if (input.body) headers.set("content-type", "application/json")
  return app.request(input.path, {
    method: input.method ?? "GET",
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
}

/** 中文注释：创建最小 git 仓库，模拟前端和后端解决方案目录。 */
async function createRepo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

beforeAll(async () => {
  if (!on) return
  const ready = await boot()
  state.app = ready.app
})

describe("account context products", () => {
  const product_ids: string[] = []
  const solution_ids: string[] = []
  const project_ids: string[] = []
  const session_ids: string[] = []
  const created_user_ids: string[] = []
  const token_hashes: string[] = []
  const user_ids = new Set<string>()

  afterEach(async () => {
    await Database.use(async (db) => {
      if (session_ids.length > 0) {
        await db.delete(SessionTable).where(inArray(SessionTable.id, [...session_ids])).run()
      }
      if (token_hashes.length > 0) {
        await db.delete(TpSessionTokenTable).where(inArray(TpSessionTokenTable.token_hash, [...token_hashes])).run()
      }
      if (created_user_ids.length > 0) {
        await db
          .update(TpUserTable)
          .set({
            time_deleted: Date.now(),
          })
          .where(inArray(TpUserTable.id, [...created_user_ids]))
          .run()
      }
      if (user_ids.size > 0) {
        await db.delete(TpUserProjectStateTable).where(inArray(TpUserProjectStateTable.user_id, [...user_ids])).run()
      }
      if (project_ids.length > 0 && user_ids.size > 0) {
        await db.delete(TpProjectUserAccessTable)
          .where(inArray(TpProjectUserAccessTable.project_id, [...project_ids]))
          .run()
      }
      if (solution_ids.length > 0) {
        await db.delete(TpProductSolutionRootTable).where(inArray(TpProductSolutionRootTable.solution_id, [...solution_ids])).run()
        await db.delete(TpProductSolutionBindingTable).where(inArray(TpProductSolutionBindingTable.solution_id, [...solution_ids])).run()
        await db.delete(TpProductSolutionTable).where(inArray(TpProductSolutionTable.id, [...solution_ids])).run()
      }
      if (product_ids.length > 0) {
        await db.delete(TpProductTable).where(inArray(TpProductTable.id, [...product_ids])).run()
      }
      if (project_ids.length > 0) {
        await db.delete(ProjectTable).where(inArray(ProjectTable.id, [...project_ids])).run()
      }
    })
    product_ids.length = 0
    solution_ids.length = 0
    project_ids.length = 0
    session_ids.length = 0
    created_user_ids.length = 0
    token_hashes.length = 0
    user_ids.clear()
  })

  test.skipIf(!on)("lists only real products on the product selection page", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "frontend")
    const backend = await createRepo(tmp.path, "backend")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)

    const product = await AccountProductService.create({
      name: "慢病管理系统",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const frontend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端",
      code: "frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(frontend_solution.ok).toBe(true)
    if (!frontend_solution.ok) return
    solution_ids.push(frontend_solution.item.id)

    const backend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "后端",
      code: "backend",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          mount_name: "backend",
          sort_order: 2,
        },
      ],
    })
    expect(backend_solution.ok).toBe(true)
    if (!backend_solution.ok) return
    solution_ids.push(backend_solution.item.id)

    project_ids.push(frontend_solution.item.primary_project_id ?? "", backend_solution.item.primary_project_id ?? "")
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values(
          project_ids.filter(Boolean).map((project_id) => ({
            project_id,
            user_id: session.user.id,
            mode: "allow",
          })),
        )
        .onConflictDoNothing()
        .run()
    })
    for (const project_id of project_ids.filter(Boolean)) {
      AccountContextService.invalidateProjectAccess({
        user_id: session.user.id,
        project_id,
      })
    }

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      products: Array<{
        id: string
        name: string
        project_id?: string
        worktree?: string
        related_project_ids?: string[]
        paths?: string[]
      }>
    }
    expect(body.products.some((item) => item.id.startsWith("project_"))).toBe(false)
    expect(body.products.some((item) => item.id === product.item.id && item.name === "慢病管理系统")).toBe(true)
    const target = body.products.find((item) => item.id === product.item.id)
    expect(!!target?.project_id).toBe(true)
    expect(!!target?.worktree).toBe(true)
    expect(target?.related_project_ids?.length).toBe(2)
    expect(target?.paths).toEqual([frontend, backend])

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: session.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
  }, 20_000)

  test.skipIf(!on)("hides soft-deleted products from the user product selection list", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "frontend")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)

    const visible = await AccountProductService.create({
      name: "慢病管理系统",
      directory: "",
    })
    expect(visible.ok).toBe(true)
    if (!visible.ok) return
    product_ids.push(visible.item.id)

    const prefixed = await AccountProductService.create({
      name: "删-仍然可见的产品",
      directory: "",
    })
    expect(prefixed.ok).toBe(true)
    if (!prefixed.ok) return
    product_ids.push(prefixed.item.id)

    const hidden = await AccountProductService.create({
      name: "真正逻辑删除的产品",
      directory: "",
    })
    expect(hidden.ok).toBe(true)
    if (!hidden.ok) return
    product_ids.push(hidden.item.id)

    const visible_solution = await ProductSolutionService.create({
      product_id: visible.item.id,
      name: "前端",
      code: "frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(visible_solution.ok).toBe(true)
    if (!visible_solution.ok) return
    solution_ids.push(visible_solution.item.id)
    project_ids.push(visible_solution.item.primary_project_id ?? "")

    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    await Database.use(async (db) => {
      await db
        .update(TpProductTable)
        .set({
          time_deleted: Date.now(),
        })
        .where(eq(TpProductTable.id, hidden.item.id))
        .run()
      await db.insert(TpProjectUserAccessTable)
        .values(
          project_ids.filter(Boolean).map((project_id) => ({
            project_id,
            user_id: session.user.id,
            mode: "allow",
          })),
        )
        .onConflictDoNothing()
        .run()
    })
    for (const project_id of project_ids.filter(Boolean)) {
      AccountContextService.invalidateProjectAccess({
        user_id: session.user.id,
        project_id,
      })
    }

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      products: Array<{ id: string; name: string }>
    }

    expect(body.products.some((item) => item.name === "慢病管理系统")).toBe(true)
    expect(body.products.some((item) => item.name === "删-仍然可见的产品")).toBe(true)
    expect(body.products.some((item) => item.name === "真正逻辑删除的产品")).toBe(false)
  }, 20_000)

  test.skipIf(!on)("returns account-level recent products in most-recent-first order", async () => {
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)

    const alpha = await AccountProductService.create({
      name: "最近产品-A",
      directory: "",
    })
    expect(alpha.ok).toBe(true)
    if (!alpha.ok) return
    product_ids.push(alpha.item.id)

    const beta = await AccountProductService.create({
      name: "最近产品-B",
      directory: "",
    })
    expect(beta.ok).toBe(true)
    if (!beta.ok) return
    product_ids.push(beta.item.id)

    const gamma = await AccountProductService.create({
      name: "最近产品-C",
      directory: "",
    })
    expect(gamma.ok).toBe(true)
    if (!gamma.ok) return
    product_ids.push(gamma.item.id)

    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: alpha.item.id,
    })
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: beta.item.id,
    })
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: gamma.item.id,
    })
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: beta.item.id,
    })

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      recent_product_ids?: string[]
      last_product_id?: string
    }

    expect(body.last_product_id).toBe(beta.item.id)
    expect(body.recent_product_ids).toEqual([beta.item.id, gamma.item.id, alpha.item.id])
  }, 20_000)

  test.skipIf(!on)("keeps solution project ids in product payload even when only the anchor project is directly allowed", async () => {
    await using tmp = await tmpdir()
    const anchor = await createRepo(tmp.path, "anchor")
    const frontend = await createRepo(tmp.path, "frontend")
    const backend = await createRepo(tmp.path, "backend")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)

    const product = await AccountProductService.create({
      name: "产品上下文项目",
      directory: anchor,
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const frontend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端方案",
      code: "frontend_scope",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(frontend_solution.ok).toBe(true)
    if (!frontend_solution.ok) return
    solution_ids.push(frontend_solution.item.id)

    const backend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "后端方案",
      code: "backend_scope",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          mount_name: "backend",
          sort_order: 2,
        },
      ],
    })
    expect(backend_solution.ok).toBe(true)
    if (!backend_solution.ok) return
    solution_ids.push(backend_solution.item.id)

    const anchor_project_id = product.item.project_id ?? ""
    const solution_project_ids = [frontend_solution.item.primary_project_id ?? "", backend_solution.item.primary_project_id ?? ""]
      .filter(Boolean)
    project_ids.push(anchor_project_id, ...solution_project_ids)
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values(
          [anchor_project_id]
            .filter(Boolean)
            .map((project_id) => ({
              project_id,
              user_id: session.user.id,
              mode: "allow",
            })),
        )
        .onConflictDoNothing()
        .run()
    })
    for (const project_id of [anchor_project_id, ...solution_project_ids].filter(Boolean)) {
      AccountContextService.invalidateProjectAccess({
        user_id: session.user.id,
        project_id,
      })
    }

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      products: Array<{
        id: string
        related_project_ids?: string[]
        paths?: string[]
      }>
    }
    const target = body.products.find((item) => item.id === product.item.id)
    expect(target?.related_project_ids).toEqual(solution_project_ids)
    expect(target?.paths).toEqual([frontend, backend])

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: session.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as {
      access_token?: string
      product?: {
        related_project_ids?: string[]
      }
    }
    expect(selectedBody.product?.related_project_ids).toEqual(solution_project_ids)
    if (!selectedBody.access_token) throw new Error("selected_token_missing")

    const patched = await req({
      path: "/account/context/state",
      method: "PATCH",
      token: selectedBody.access_token,
      body: {
        open_project_ids: solution_project_ids,
      },
    })
    expect(patched.status).toBe(200)
    const state = (await patched.json()) as {
      open_project_ids: string[]
    }
    expect(state.open_project_ids).toEqual(solution_project_ids)

    const projects = await req({
      path: "/account/context/projects",
      token: selectedBody.access_token,
    })
    expect(projects.status).toBe(200)
    const projectBody = (await projects.json()) as {
      projects: Array<{ id: string }>
    }
    expect(projectBody.projects.map((item) => item.id)).toEqual(expect.arrayContaining(solution_project_ids))
  }, 20_000)

  test.skipIf(!on)("restores the last selected product context on next login", async () => {
    await using tmp = await tmpdir()
    const backend = await createRepo(tmp.path, "backend")
    const frontend = await createRepo(tmp.path, "frontend")
    const first = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(first.status).toBe(200)
    const initial = (await first.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(initial.user.id)
    token_hashes.push(
      initial.access_token ? (await import("../../src/user/service")).UserService.tokenHash(initial.access_token) : "",
      initial.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(initial.refresh_token) : "",
    )

    const product = await AccountProductService.create({
      name: "登录恢复产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "恢复后端",
      code: `restore_backend_${Date.now()}`,
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "恢复后端",
          mount_name: "backend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return
    solution_ids.push(solution.item.id)

    const project_id = solution.item.primary_project_id
    expect(!!project_id).toBe(true)
    if (!project_id) throw new Error("project_missing")
    project_ids.push(project_id)

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values({
          project_id,
          user_id: initial.user.id,
          mode: "allow",
        })
        .onConflictDoNothing()
        .run()
    })
    AccountContextService.invalidateProjectAccess({
      user_id: initial.user.id,
      project_id,
    })

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: initial.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as {
      access_token?: string
      refresh_token?: string
    }
    token_hashes.push(
      selectedBody.access_token ? (await import("../../src/user/service")).UserService.tokenHash(selectedBody.access_token) : "",
      selectedBody.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(selectedBody.refresh_token) : "",
    )

    const second = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(second.status).toBe(200)
    const body = (await second.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    expect(body.user?.context_product_id).toBe(product.item.id)
    expect(body.user?.context_project_id).toBe(project_id)
    token_hashes.push(
      body.access_token ? (await import("../../src/user/service")).UserService.tokenHash(body.access_token) : "",
      body.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(body.refresh_token) : "",
    )

    const created = await req({
      path: "/session?directory=" + encodeURIComponent(frontend),
      method: "POST",
      token: body.access_token,
      body: {
        title: "explicit_directory_session",
      },
    })
    expect(created.status).toBe(200)
    const createdBody = (await created.json()) as { directory?: string }
    expect(createdBody.directory).toContain("build-overlay")
  }, 20_000)

  test.skipIf(!on)("allows selecting a product even when the derived anchor project is not directly accessible", async () => {
    await using tmp = await tmpdir()
    const backend = await createRepo(tmp.path, "cshis-backend")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    const product = await AccountProductService.create({
      name: `CSHIS回归_${Date.now()}`,
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const legacy_project_id = `legacy_${Date.now()}`
    const legacy_directory = path.join(tmp.path, "legacy-anchor")
    await fs.mkdir(legacy_directory, { recursive: true })
    await Database.use((db) =>
      db.insert(ProjectTable)
        .values({
          id: legacy_project_id,
          worktree: legacy_directory,
          vcs: null,
          name: "legacy-anchor",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run(),
    )
    project_ids.push(legacy_project_id)

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "CSHIS后端",
      code: `cshis_backend_${Date.now()}`,
      primary_project_id: legacy_project_id,
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          mount_name: "backend",
          sort_order: 1,
        },
      ],
    })
    expect(solution.ok).toBe(true)
    if (!solution.ok) return
    solution_ids.push(solution.item.id)

    const derived = await ensureProjectByDirectory(backend)
    expect(!!derived?.id).toBe(true)
    if (!derived?.id) throw new Error("derived_project_missing")
    project_ids.push(derived.id)

    const products = await req({
      path: "/account/context/products",
      token: session.access_token,
    })
    expect(products.status).toBe(200)

    await Database.use((db) =>
      db.insert(TpProjectUserAccessTable)
        .values([
          {
            project_id: legacy_project_id,
            user_id: session.user.id,
            mode: "allow",
          },
          {
            project_id: derived.id,
            user_id: session.user.id,
            mode: "deny",
          },
        ])
        .onConflictDoNothing()
        .run(),
    )
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: legacy_project_id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: derived.id,
    })

    const listed = await req({
      path: "/account/context/products",
      token: session.access_token,
    })
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()) as {
      products: Array<{ id: string; project_id?: string; worktree?: string; related_project_ids?: string[]; paths?: string[] }>
    }
    const current = listedBody.products.find((item) => item.id === product.item.id)
    expect(current?.id).toBe(product.item.id)
    expect(current?.project_id).toBeUndefined()
    expect(current?.related_project_ids).toEqual([derived.id])
    expect(current?.paths).toEqual([backend])

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: session.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as {
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    expect(selectedBody.user?.context_product_id).toBe(product.item.id)
    expect(selectedBody.user?.context_project_id).toBe(derived.id)
  }, 20_000)

  test.skipIf(!on)("allows switching to another related project after selecting a product", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "cshis-api")
    const client = await createRepo(tmp.path, "cshis-client")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    const product = await AccountProductService.create({
      name: `CSHIS切换回归_${Date.now()}`,
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const apiSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "API",
      code: `api_${Date.now()}`,
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "API",
          mount_name: "api",
          sort_order: 1,
        },
      ],
    })
    expect(apiSolution.ok).toBe(true)
    if (!apiSolution.ok) return
    solution_ids.push(apiSolution.item.id)

    const clientSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "客户端",
      code: `client_${Date.now()}`,
      build_profile: {
        workdirs: ["client"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: client,
          display_name: "客户端",
          mount_name: "client",
          sort_order: 2,
        },
      ],
    })
    expect(clientSolution.ok).toBe(true)
    if (!clientSolution.ok) return
    solution_ids.push(clientSolution.item.id)

    const apiProject = await ensureProjectByDirectory(api)
    const clientProject = await ensureProjectByDirectory(client)
    expect(apiProject?.id).toBeTruthy()
    expect(clientProject?.id).toBeTruthy()
    if (!apiProject?.id || !clientProject?.id) return
    project_ids.push(apiProject.id, clientProject.id)

    await Database.use((db) =>
      db.insert(TpProjectUserAccessTable)
        .values({
          project_id: apiProject.id,
          user_id: session.user.id,
          mode: "allow",
        })
        .onConflictDoNothing()
        .run(),
    )
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: apiProject.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: clientProject.id,
    })

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: session.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    token_hashes.push(
      selectedBody.access_token ? (await import("../../src/user/service")).UserService.tokenHash(selectedBody.access_token) : "",
      selectedBody.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(selectedBody.refresh_token) : "",
    )
    expect(selectedBody.user?.context_product_id).toBe(product.item.id)
    expect(selectedBody.user?.context_project_id).toBe(apiProject.id)

    const switched = await req({
      path: "/account/context/select",
      method: "POST",
      token: selectedBody.access_token,
      body: {
        project_id: clientProject.id,
      },
    })
    expect(switched.status).toBe(200)
    const switchedBody = (await switched.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    token_hashes.push(
      switchedBody.access_token ? (await import("../../src/user/service")).UserService.tokenHash(switchedBody.access_token) : "",
      switchedBody.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(switchedBody.refresh_token) : "",
    )
    expect(switchedBody.user?.context_product_id).toBe(product.item.id)
    expect(switchedBody.user?.context_project_id).toBe(clientProject.id)
  }, 20_000)

  test.skipIf(!on)("restores the last related project when logging back into a product-only context", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "login-restore-api")
    const client = await createRepo(tmp.path, "login-restore-client")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    const product = await AccountProductService.create({
      name: `产品恢复回归_${Date.now()}`,
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const legacyDirectory = path.join(tmp.path, "legacy-anchor")
    await fs.mkdir(legacyDirectory, { recursive: true })
    const legacyProjectID = `legacy_${Date.now()}`
    await Database.use((db) =>
      db.insert(ProjectTable)
        .values({
          id: legacyProjectID,
          worktree: legacyDirectory,
          vcs: null,
          name: "legacy-anchor",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run(),
    )
    project_ids.push(legacyProjectID)

    const apiSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "API",
      code: `login_api_${Date.now()}`,
      primary_project_id: legacyProjectID,
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "API",
          mount_name: "api",
          sort_order: 1,
        },
      ],
    })
    expect(apiSolution.ok).toBe(true)
    if (!apiSolution.ok) return
    solution_ids.push(apiSolution.item.id)

    const clientSolution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "客户端",
      code: `login_client_${Date.now()}`,
      primary_project_id: legacyProjectID,
      build_profile: {
        workdirs: ["client"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: client,
          display_name: "客户端",
          mount_name: "client",
          sort_order: 2,
        },
      ],
    })
    expect(clientSolution.ok).toBe(true)
    if (!clientSolution.ok) return
    solution_ids.push(clientSolution.item.id)

    const apiProject = await ensureProjectByDirectory(api)
    const clientProject = await ensureProjectByDirectory(client)
    expect(apiProject?.id).toBeTruthy()
    expect(clientProject?.id).toBeTruthy()
    if (!apiProject?.id || !clientProject?.id) return
    project_ids.push(apiProject.id, clientProject.id)

    await Database.use((db) =>
      db.insert(TpProjectUserAccessTable)
        .values({
          project_id: apiProject.id,
          user_id: session.user.id,
          mode: "allow",
        })
        .onConflictDoNothing()
        .run(),
    )
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: product.item.id,
      project_id: clientProject.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: apiProject.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: clientProject.id,
    })

    const relogin = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(relogin.status).toBe(200)
    const reloginBody = (await relogin.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    token_hashes.push(
      reloginBody.access_token ? (await import("../../src/user/service")).UserService.tokenHash(reloginBody.access_token) : "",
      reloginBody.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(reloginBody.refresh_token) : "",
    )
    expect(reloginBody.user?.context_product_id).toBe(product.item.id)
    expect(reloginBody.user?.context_project_id).toBe(clientProject.id)
  }, 20_000)

  test.skipIf(!on)("lists products from primary projects even when solution directories are temporarily unavailable", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "frontend")
    const backend = await createRepo(tmp.path, "backend")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })

    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)

    const product = await AccountProductService.create({
      name: "共享盘抖动产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const frontend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "前端",
      code: "frontend-light",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })
    expect(frontend_solution.ok).toBe(true)
    if (!frontend_solution.ok) return
    solution_ids.push(frontend_solution.item.id)

    const backend_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "后端",
      code: "backend-light",
      build_profile: {
        workdirs: ["backend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          mount_name: "backend",
          sort_order: 2,
        },
      ],
    })
    expect(backend_solution.ok).toBe(true)
    if (!backend_solution.ok) return
    solution_ids.push(backend_solution.item.id)

    project_ids.push(frontend_solution.item.primary_project_id ?? "", backend_solution.item.primary_project_id ?? "")
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values(
          project_ids.filter(Boolean).map((project_id) => ({
            project_id,
            user_id: session.user.id,
            mode: "allow",
          })),
        )
        .onConflictDoNothing()
        .run()
    })
    for (const project_id of project_ids.filter(Boolean)) {
      AccountContextService.invalidateProjectAccess({
        user_id: session.user.id,
        project_id,
      })
    }

    await fs.rm(frontend, { recursive: true, force: true })
    await fs.rm(backend, { recursive: true, force: true })

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      products: Array<{
        id: string
        name: string
        project_id?: string
        related_project_ids?: string[]
        paths?: string[]
      }>
    }
    const target = body.products.find((item) => item.id === product.item.id)
    expect(target?.name).toBe("共享盘抖动产品")
    expect(target?.project_id).toBe(frontend_solution.item.primary_project_id)
    expect(target?.related_project_ids).toEqual(
      [frontend_solution.item.primary_project_id, backend_solution.item.primary_project_id].filter(Boolean),
    )
    expect(target?.paths).toEqual([frontend, backend])
  }, 20_000)

  test.skipIf(!on)("super admin can still see product-only entries even without derived project access", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "cshis-api")
    const client = await createRepo(tmp.path, "cshis-client")
    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username: "admin",
        password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
      },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    user_ids.add(session.user.id)
    token_hashes.push(
      session.access_token ? (await import("../../src/user/service")).UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(session.refresh_token) : "",
    )

    const product = await AccountProductService.create({
      name: `CSHIS可见性_${Date.now()}`,
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const api_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "API",
      code: `api_${Date.now()}`,
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          mount_name: "api",
        },
      ],
    })
    expect(api_solution.ok).toBe(true)
    if (!api_solution.ok) return
    solution_ids.push(api_solution.item.id)

    const client_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "客户端",
      code: `client_${Date.now()}`,
      build_profile: {
        workdirs: ["client"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: client,
          mount_name: "client",
        },
      ],
    })
    expect(client_solution.ok).toBe(true)
    if (!client_solution.ok) return
    solution_ids.push(client_solution.item.id)

    const response = await req({
      path: "/account/context/products",
      token: session.access_token,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      products: Array<{ id: string; name: string; paths?: string[] }>
    }
    const target = body.products.find((item) => item.id === product.item.id)
    expect(target?.name).toBe(product.item.name)
    expect(target?.paths).toEqual([api, client])
  }, 20_000)

  test.skipIf(!on)("allows config bootstrap and session creation in product-only context", async () => {
    const { UserService } = await import("../../src/user/service")
    const username = `product_only_${Date.now()}`
    const password = "TpCode@123A"
    const createdUser = await UserService.createUser({
      username,
      password,
      display_name: "Product Only Context User",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdUser.ok).toBe(true)
    if (!("id" in createdUser) || !createdUser.id) return
    created_user_ids.push(createdUser.id)
    user_ids.add(createdUser.id)

    const product = await AccountProductService.create({
      name: `产品空上下文回归_${Date.now()}`,
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const developer = await Database.use((db) =>
      db.select().from(TpRoleTable).where(eq(TpRoleTable.code, "developer")).get(),
    )
    expect(developer?.id).toBeTruthy()
    if (!developer?.id) return
    await Database.use((db) =>
      db.insert(TpRoleProductAccessTable)
        .values({
          product_id: product.item.id,
          role_id: developer.id,
        })
        .onConflictDoNothing()
        .run(),
    )

    const login = await req({
      path: "/account/login",
      method: "POST",
      body: {
        username,
        password,
      },
    })
    expect(login.status).toBe(200)
    const session = (await login.json()) as {
      access_token: string
      refresh_token: string
      user: { id: string }
    }
    token_hashes.push(
      session.access_token ? UserService.tokenHash(session.access_token) : "",
      session.refresh_token ? UserService.tokenHash(session.refresh_token) : "",
    )

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: session.access_token,
      body: {
        product_id: product.item.id,
      },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    token_hashes.push(
      selectedBody.access_token ? UserService.tokenHash(selectedBody.access_token) : "",
      selectedBody.refresh_token ? UserService.tokenHash(selectedBody.refresh_token) : "",
    )
    expect(selectedBody.user?.context_product_id).toBe(product.item.id)
    expect(selectedBody.user?.context_project_id).toBeUndefined()

    const config = await req({
      path: "/config",
      token: selectedBody.access_token,
    })
    expect(config.status).toBe(200)

    const listed = await req({
      path: "/experimental/session?limit=10",
      token: selectedBody.access_token,
    })
    expect(listed.status).toBe(200)

    const created = await req({
      path: "/session",
      method: "POST",
      token: selectedBody.access_token,
      body: {
        title: "product_only_context_session",
      },
    })
    expect(created.status).toBe(200)
    const createdBody = (await created.json()) as { id?: string; title?: string }
    expect(createdBody.title).toBe("product_only_context_session")
    if (createdBody.id) session_ids.push(createdBody.id)
  }, 20_000)
})
