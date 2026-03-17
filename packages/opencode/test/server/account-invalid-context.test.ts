import { beforeAll, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq, inArray } from "../../src/storage/db"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"
import { TpProjectUserAccessTable } from "../../src/user/project-user-access.sql"
import { TpSessionTokenTable } from "../../src/user/token.sql"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

/** 中文注释：启动测试服务，并确保账号种子已初始化，供鉴权中间件复用。 */
async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), user: UserService }
}

const state = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof boot>>["user"] | undefined,
}

/** 中文注释：统一发起测试请求，避免每个用例重复组装请求头。 */
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

/** 中文注释：生成测试专用标识，避免与库里已有项目冲突。 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

beforeAll(async () => {
  if (!on) return
  const ready = await boot()
  state.app = ready.app
  state.user = ready.user
})

describe("account invalid project context", () => {
  test.skipIf(!on)(
    "clears persisted context when the selected project worktree is unavailable",
    async () => {
      const user = state.user
      if (!user) throw new Error("user_service_missing")
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
        user: { id: string }
      }
      const user_id = session.user.id
      const project_id = uid("invalid_context_project")
      const worktree = `/tmp/${uid("missing_worktree")}`

      await Database.use(async (db) => {
        await db.insert(ProjectTable)
          .values({
            id: project_id,
            worktree,
            vcs: null,
            name: uid("invalid_context_name"),
            icon_url: null,
            icon_color: null,
            sandboxes: [],
            commands: null,
            time_initialized: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
        await db.insert(TpProjectUserAccessTable)
          .values({
            project_id,
            user_id,
            mode: "allow",
          })
          .run()
      })

      const selected = await user.selectContext({
        user_id,
        project_id,
      })
      expect(selected.ok).toBe(true)
      if (!selected.ok) throw new Error("select_context_failed")

      try {
        const response = await req({
          path: "/account/me",
          token: selected.access_token,
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          context_project_id?: string
        }
        expect(body.context_project_id).toBeUndefined()

        const hashes = [user.tokenHash(selected.access_token), user.tokenHash(selected.refresh_token)]
        const rows = await Database.use((db) =>
          db
            .select({
              token_hash: TpSessionTokenTable.token_hash,
              context_project_id: TpSessionTokenTable.context_project_id,
            })
            .from(TpSessionTokenTable)
            .where(inArray(TpSessionTokenTable.token_hash, hashes))
            .all(),
        )
        expect(rows).toHaveLength(2)
        expect(rows.every((row) => !row.context_project_id)).toBe(true)
      } finally {
        await Database.use(async (db) => {
          await db.delete(TpProjectUserAccessTable)
            .where(eq(TpProjectUserAccessTable.project_id, project_id))
            .run()
          await db.delete(TpSessionTokenTable)
            .where(inArray(TpSessionTokenTable.token_hash, [
              user.tokenHash(selected.access_token),
              user.tokenHash(selected.refresh_token),
            ]))
            .run()
          await db.delete(ProjectTable).where(eq(ProjectTable.id, project_id)).run()
        })
      }
    },
    20_000,
  )
})
