import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { Log } from "../../src/util/log"
import { Flag } from "../../src/flag/flag"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App() }
}

const mem = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
}

/**
 * 中文注释：生成测试用唯一主键，避免不同用例相互影响。
 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 中文注释：统一封装测试请求，便于复用鉴权逻辑。
 */
async function req(input: { path: string; method?: string; token?: string; body?: Record<string, unknown> }) {
  const app = mem.app
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

/**
 * 中文注释：登录默认管理员账号，获取后续接口测试所需 token。
 */
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
  const body = (await response.json()) as { access_token?: string }
  expect(typeof body.access_token).toBe("string")
  return body.access_token!
}

beforeAll(async () => {
  if (!on) return
  mem.app = (await boot()).app
})

afterEach(async () => {
  await Database.use((db) => db.delete(TpSavedPlanTable).run())
})

describe("account vho feedback routes", () => {
  test.skipIf(!on)("proxies list request with current user phone", async () => {
    const token = await login()
    await req({
      path: "/account/me/vho-bind",
      method: "POST",
      token,
      body: { phone: "13800138000" },
    })
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: "查询成功",
          content: {
            loginInfo: {
              userId: "13800138000",
              userName: "系统管理员",
            },
            feedbackData: {
              list: [
                {
                  feedbackId: "F-1",
                  planId: "plan_1",
                  feedbackDes: "登录慢",
                },
              ],
              total: 1,
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )

    const response = await req({
      path: "/account/vho-feedback/list",
      method: "POST",
      token,
      body: {
        feedback_id: "F-1",
        page_num: 1,
        page_size: 10,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok?: boolean
      list?: Array<{ feedback_id: string; plan_id?: string; feedback_des?: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.list).toEqual([{ feedback_id: "F-1", plan_id: "plan_1", feedback_des: "登录慢" }])
    const [, init] = fetch.mock.calls[0]!
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toMatchObject({
      userId: "13800138000",
      feedbackId: "F-1",
      pageNum: 1,
      pageSize: 10,
    })
    fetch.mockRestore()
  })

  test.skipIf(!on)("resolves prompt text from saved plan", async () => {
    const token = await login()
    const now = Date.now()
    await Database.use((db) =>
      db
        .insert(TpSavedPlanTable)
        .values({
          id: "plan_route_1",
          session_id: uid("session"),
          message_id: uid("message"),
          part_id: uid("part"),
          project_id: uid("project"),
          project_name: "测试项目",
          project_worktree: process.cwd(),
          session_title: "测试会话",
          user_id: uid("user"),
          username: uid("username"),
          display_name: "测试用户",
          account_type: "internal",
          org_id: uid("org"),
          department_id: "",
          agent: "plan",
          provider_id: "openai",
          model_id: "gpt-4.1-mini",
          message_created_at: now,
          plan_content: "先抓日志，再查接口。",
          vho_feedback_no: "F-2",
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    const response = await req({
      path: "/account/vho-feedback/resolve",
      method: "POST",
      token,
      body: {
        feedback_id: "F-2",
        feedback_des: "登录超时",
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok?: boolean
      matched_by?: string
      prompt_text?: string
    }
    expect(body.ok).toBe(true)
    expect(body.matched_by).toBe("feedback_id")
    expect(body.prompt_text).toBe("反馈问题：登录超时\n\n计划内容：先抓日志，再查接口。")
  })
})
