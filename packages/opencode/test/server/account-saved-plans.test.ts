import { beforeAll, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { Database, inArray } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

/** 中文注释：启动测试用服务端应用，并确保管理员种子数据可用于登录。 */
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

/** 中文注释：生成测试专用唯一标识，避免和已有数据发生主键冲突。 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 中文注释：统一发起服务端请求，减少各测试之间的重复样板代码。 */
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

/** 中文注释：登录测试管理员账号，获取可调用管理接口的访问令牌。 */
async function login(username: string, password: string) {
  const response = await req({
    path: "/account/login",
    method: "POST",
    body: { username, password },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  expect(!!token).toBe(true)
  return token!
}

/** 中文注释：构造保存计划测试数据，确保目标产品的计划不落在全库最近 100 条之内。 */
function savedPlanRow(input: {
  id: string
  project_id: string
  project_name: string
  time_created: number
  session_title: string
}) {
  return {
    id: input.id,
    session_id: uid("session"),
    message_id: uid("message"),
    part_id: uid("part"),
    project_id: input.project_id,
    project_name: input.project_name,
    project_worktree: `/${input.project_id}`,
    session_title: input.session_title,
    user_id: "user_tp_admin",
    username: "admin",
    display_name: "系统管理员",
    account_type: "internal",
    org_id: "org_tp_internal",
    department_id: "",
    agent: "plan",
    provider_id: "openai",
    model_id: "gpt-4.1-mini",
    message_created_at: input.time_created,
    plan_content: `plan:${input.id}`,
    vho_feedback_no: null,
    time_created: input.time_created,
    time_updated: input.time_created,
  }
}

beforeAll(async () => {
  if (!on) return
  const ready = await boot()
  state.app = ready.app
})

describe("account saved plans", () => {
  test.skipIf(!on)("filters by product before limit so older product plans are still returned", async () => {
    const token = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")
    const now = Date.now()
    const target_project_id = uid("project_target")
    const other_project_id = uid("project_other")
    const product_id = uid("product")
    const target_plan_ids = [uid("plan_target_a"), uid("plan_target_b")]
    const other_plan_ids = Array.from({ length: 105 }, (_, index) => uid(`plan_other_${index}`))
    const all_plan_ids = [...target_plan_ids, ...other_plan_ids]
    const project_ids = [target_project_id, other_project_id]

    try {
      await Database.use(async (db) => {
        await db.insert(ProjectTable)
          .values([
            {
              id: target_project_id,
              worktree: `/tmp/${target_project_id}`,
              vcs: null,
              name: uid("target_project_name"),
              icon_url: null,
              icon_color: null,
              sandboxes: [],
              commands: null,
              time_initialized: null,
              time_created: now,
              time_updated: now,
            },
            {
              id: other_project_id,
              worktree: `/tmp/${other_project_id}`,
              vcs: null,
              name: uid("other_project_name"),
              icon_url: null,
              icon_color: null,
              sandboxes: [],
              commands: null,
              time_initialized: null,
              time_created: now,
              time_updated: now,
            },
          ])
          .run()
        await db.insert(TpProductTable)
          .values({
            id: product_id,
            name: uid("product_name"),
            project_id: target_project_id,
            time_created: now,
            time_updated: now,
          })
          .run()
        await db.insert(TpSavedPlanTable)
          .values([
            savedPlanRow({
              id: target_plan_ids[0]!,
              project_id: target_project_id,
              project_name: "国家医保",
              time_created: now - 20_000,
              session_title: "target-plan-a",
            }),
            savedPlanRow({
              id: target_plan_ids[1]!,
              project_id: target_project_id,
              project_name: "国家医保",
              time_created: now - 10_000,
              session_title: "target-plan-b",
            }),
            ...other_plan_ids.map((id, index) =>
              savedPlanRow({
                id,
                project_id: other_project_id,
                project_name: "其他项目",
                time_created: now + index,
                session_title: `other-plan-${index}`,
              }),
            ),
          ])
          .run()
      })

      const response = await req({
        path: `/account/admin/saved-plans?product_id=${encodeURIComponent(product_id)}&limit=100`,
        token,
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as Array<{ id: string; project_id: string }>
      expect(body).toHaveLength(2)
      expect(body.map((item) => item.id)).toEqual([target_plan_ids[1], target_plan_ids[0]])
      expect(body.every((item) => item.project_id === target_project_id)).toBe(true)
    } finally {
      await Database.use(async (db) => {
        await db.delete(TpSavedPlanTable).where(inArray(TpSavedPlanTable.id, all_plan_ids)).run()
        await db.delete(TpProductTable).where(inArray(TpProductTable.id, [product_id])).run()
        await db.delete(ProjectTable).where(inArray(ProjectTable.id, project_ids)).run()
      })
    }
  })
})
