import { $ } from "bun"
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Database, eq, inArray } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"
import { TpProjectUserAccessTable } from "../../src/user/project-user-access.sql"
import { TpProductSolutionBindingTable } from "../../src/user/product-solution-binding.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { TpSessionTokenTable } from "../../src/user/token.sql"
import { TpUserProjectStateTable } from "../../src/user/user-project-state.sql"
import { AccountContextService } from "../../src/user/context"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { ensureProjectByDirectory } from "../../src/user/product-anchor"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

/** 中文注释：启动测试服务并预置管理员账号，供登录上下文回归测试复用。 */
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

/** 中文注释：统一发送测试请求，避免每个用例重复拼接 headers 和 body。 */
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

/** 中文注释：创建最小 git 仓库，模拟产品绑定的解决方案源码目录。 */
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
  state.app = (await boot()).app
})

describe("account login product context", () => {
  const product_ids: string[] = []
  const solution_ids: string[] = []
  const project_ids: string[] = []
  const token_hashes: string[] = []
  const user_ids = new Set<string>()

  afterEach(async () => {
    await Bun.sleep(300)
    await Database.use(async (db) => {
      if (token_hashes.length > 0) {
        await db.delete(TpSessionTokenTable).where(inArray(TpSessionTokenTable.token_hash, [...token_hashes])).run()
      }
      if (user_ids.size > 0) {
        await db.delete(TpUserProjectStateTable).where(inArray(TpUserProjectStateTable.user_id, [...user_ids])).run()
      }
      if (project_ids.length > 0) {
        await db.delete(TpProjectUserAccessTable).where(inArray(TpProjectUserAccessTable.project_id, [...project_ids])).run()
      }
      if (solution_ids.length > 0) {
        await db.delete(TpProductSolutionRootTable).where(inArray(TpProductSolutionRootTable.solution_id, [...solution_ids])).run()
        await db.delete(TpProductSolutionBindingTable).where(inArray(TpProductSolutionBindingTable.solution_id, [...solution_ids])).run()
        await db.delete(TpProductSolutionTable).where(inArray(TpProductSolutionTable.id, [...solution_ids])).run()
      }
      if (product_ids.length > 0) {
        await db.delete(TpProductTable).where(inArray(TpProductTable.id, [...product_ids])).run()
      }
    })
    product_ids.length = 0
    solution_ids.length = 0
    project_ids.length = 0
    token_hashes.length = 0
    user_ids.clear()
  })

  test.skipIf(!on)("登录时若最后一次项目属于产品关联项目，也必须恢复产品上下文", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "api")
    const client = await createRepo(tmp.path, "client")
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
      name: "登录恢复产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const api_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "接口服务",
      code: "login-restore-api",
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "接口服务",
          mount_name: "api",
          sort_order: 0,
        },
      ],
    })
    expect(api_solution.ok).toBe(true)
    if (!api_solution.ok) return
    solution_ids.push(api_solution.item.id)

    const client_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "客户端",
      code: "login-restore-client",
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
          sort_order: 1,
        },
      ],
    })
    expect(client_solution.ok).toBe(true)
    if (!client_solution.ok) return
    solution_ids.push(client_solution.item.id)

    const api_project = await ensureProjectByDirectory(api)
    const client_project = await ensureProjectByDirectory(client)
    expect(api_project?.id).toBeTruthy()
    expect(client_project?.id).toBeTruthy()
    if (!api_project?.id || !client_project?.id) return
    project_ids.push(api_project.id, client_project.id)

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values([
          {
            project_id: api_project.id,
            user_id: session.user.id,
            mode: "allow",
          },
          {
            project_id: client_project.id,
            user_id: session.user.id,
            mode: "allow",
          },
        ])
        .onConflictDoNothing()
        .run()
    })
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: product.item.id,
      project_id: api_project.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: api_project.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: client_project.id,
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
    const relogin_body = (await relogin.json()) as {
      access_token?: string
      refresh_token?: string
      user?: {
        context_product_id?: string
        context_project_id?: string
      }
    }
    token_hashes.push(
      relogin_body.access_token ? (await import("../../src/user/service")).UserService.tokenHash(relogin_body.access_token) : "",
      relogin_body.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(relogin_body.refresh_token) : "",
    )
    expect(relogin_body.user?.context_product_id).toBe(product.item.id)
    expect(relogin_body.user?.context_project_id).toBe(api_project.id)
  }, 20_000)

  test.skipIf(!on)("产品列表在只有关联项目命中时，也应正确标记 selected 和 last_selected", async () => {
    await using tmp = await tmpdir()
    const api = await createRepo(tmp.path, "api")
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
      name: "关联项目选中产品",
      directory: "",
    })
    expect(product.ok).toBe(true)
    if (!product.ok) return
    product_ids.push(product.item.id)

    const api_solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "接口服务",
      code: "product-selected-by-related-project",
      build_profile: {
        workdirs: ["api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: api,
          display_name: "接口服务",
          mount_name: "api",
          sort_order: 0,
        },
      ],
    })
    expect(api_solution.ok).toBe(true)
    if (!api_solution.ok) return
    solution_ids.push(api_solution.item.id)

    const api_project = await ensureProjectByDirectory(api)
    expect(api_project?.id).toBeTruthy()
    if (!api_project?.id) return
    project_ids.push(api_project.id)

    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values({
          project_id: api_project.id,
          user_id: session.user.id,
          mode: "allow",
        })
        .onConflictDoNothing()
        .run()
    })
    await AccountContextService.remember({
      user_id: session.user.id,
      product_id: product.item.id,
      project_id: api_project.id,
    })
    AccountContextService.invalidateProjectAccess({
      user_id: session.user.id,
      project_id: api_project.id,
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
    const relogin_body = (await relogin.json()) as {
      access_token?: string
      refresh_token?: string
    }
    token_hashes.push(
      relogin_body.access_token ? (await import("../../src/user/service")).UserService.tokenHash(relogin_body.access_token) : "",
      relogin_body.refresh_token ? (await import("../../src/user/service")).UserService.tokenHash(relogin_body.refresh_token) : "",
    )

    const products = await req({
      path: "/account/context/products",
      token: relogin_body.access_token,
    })
    expect(products.status).toBe(200)
    const body = (await products.json()) as {
      products: Array<{
        id: string
        selected: boolean
        last_selected: boolean
      }>
    }
    const target = body.products.find((item) => item.id === product.item.id)
    expect(target?.selected).toBe(true)
    expect(target?.last_selected).toBe(true)
  }, 20_000)
})
