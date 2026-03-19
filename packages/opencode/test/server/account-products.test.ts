import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { inArray } from "../../src/storage/db"
import { Database } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"
import { TpProductTable } from "../../src/user/product.sql"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

/** 中文注释：启动测试服务并预置管理员数据，供产品管理接口验证复用。 */
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

/** 中文注释：生成隔离的测试标识，避免与库中的既有产品名称冲突。 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 中文注释：统一发起测试请求，减少各个产品接口用例的样板代码。 */
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

/** 中文注释：登录管理员账号，获取可访问产品管理接口的令牌。 */
async function login() {
  const response = await req({
    path: "/account/login",
    method: "POST",
    body: {
      username: "admin",
      password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
    },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : ""
  expect(!!token).toBe(true)
  return token
}

beforeAll(async () => {
  if (!on) return
  const ready = await boot()
  state.app = ready.app
})

describe("account products", () => {
  const created: string[] = []

  afterEach(async () => {
    if (created.length === 0) return
    await Database.use((db) => db.delete(TpProductTable).where(inArray(TpProductTable.id, [...created])).run())
    created.length = 0
  })

  test.skipIf(!on)("creates a product without requiring a bound directory", async () => {
    const token = await login()
    const name = uid("product_without_directory")

    const response = await req({
      path: "/account/admin/products",
      method: "POST",
      token,
      body: {
        name,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      item: {
        id: string
        name: string
        project_id?: string
        worktree?: string
      }
    }
    expect(body.ok).toBe(true)
    created.push(body.item.id)
    expect(body.item.name).toBe(name)
    expect(body.item.project_id).toBeUndefined()
    expect(body.item.worktree).toBeUndefined()
  })
})
