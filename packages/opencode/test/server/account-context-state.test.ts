import { beforeAll, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"

const on = Flag.TPCODE_ACCOUNT_ENABLED

const mem = {
  app: undefined as Awaited<ReturnType<typeof init>>["app"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function init() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App() }
}

async function req(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
}) {
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
  return {
    access_token: token!,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
  }
}

beforeAll(async () => {
  if (!on) return
  mem.app = (await init()).app
})

describe("account context state", () => {
  test.skipIf(!on)("sanitizes stored project ui state against current account scope", async () => {
    const loginResult = await login("admin", "TpCode@2026")
    const admin = loginResult.access_token
    const projects = await req({
      path: "/account/context/projects",
      token: admin,
    })
    expect(projects.status).toBe(200)
    const payload = (await projects.json()) as {
      projects?: Array<{ id: string; worktree: string }>
    }
    const project = payload.projects?.[0]
    expect(!!project?.id).toBe(true)
    expect(!!project?.worktree).toBe(true)
    if (!project?.id || !project.worktree) throw new Error("project_missing")

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: admin,
      body: { project_id: project.id },
    })
    expect(selected.status).toBe(200)
    const selectedBody = (await selected.json()) as Record<string, unknown>
    const token = typeof selectedBody.access_token === "string" ? selectedBody.access_token : undefined
    expect(!!token).toBe(true)
    if (!token) throw new Error("token_missing")

    const created = await req({
      path: "/session?directory=" + encodeURIComponent(project.worktree),
      method: "POST",
      token,
      body: { title: uid("context_state") },
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as { id?: string; directory?: string }
    expect(!!session.id).toBe(true)
    expect(session.directory).toBe(project.worktree)
    if (!session.id || !session.directory) throw new Error("session_missing")

    const patched = await req({
      path: "/account/context/state",
      method: "PATCH",
      token,
      body: {
        last_project_id: "project_missing",
        open_project_ids: ["project_missing", project.id, project.id],
        last_session_by_project: {
          [project.id]: {
            session_id: session.id,
            directory: session.directory,
            time_updated: Date.now(),
          },
          project_missing: {
            session_id: "session_missing",
            directory: "/tmp/missing",
            time_updated: 1,
          },
        },
        workspace_mode_by_project: {
          [project.id]: true,
          project_missing: true,
        },
        workspace_order_by_project: {
          [project.id]: ["/tmp/missing", project.worktree],
          project_missing: ["/tmp/missing"],
        },
        workspace_expanded_by_directory: {
          [project.worktree]: true,
          "/tmp/missing": true,
        },
        workspace_alias_by_project_branch: {
          [project.id]: {
            main: "Main Workspace",
          },
          project_missing: {
            ghost: "Ghost",
          },
        },
      },
    })
    expect(patched.status).toBe(200)
    const state = (await patched.json()) as {
      current_project_id?: string
      last_project_id?: string
      open_project_ids: string[]
      last_session_by_project: Record<string, { session_id: string; directory: string }>
      workspace_mode_by_project: Record<string, boolean>
      workspace_order_by_project: Record<string, string[]>
      workspace_expanded_by_directory: Record<string, boolean>
      workspace_alias_by_project_branch: Record<string, Record<string, string>>
    }

    expect(state.current_project_id).toBe(project.id)
    expect(state.last_project_id).toBeUndefined()
    expect(state.open_project_ids).toEqual([project.id])
    expect(state.last_session_by_project[project.id]?.session_id).toBe(session.id)
    expect(state.last_session_by_project.project_missing).toBeUndefined()
    expect(state.workspace_mode_by_project).toEqual({ [project.id]: true })
    expect(state.workspace_order_by_project[project.id]?.[0]).toBe(project.worktree)
    expect(state.workspace_order_by_project[project.id]).not.toContain("/tmp/missing")
    expect(state.workspace_expanded_by_directory[project.worktree]).toBe(true)
    expect(state.workspace_expanded_by_directory["/tmp/missing"]).toBeUndefined()
    expect(state.workspace_alias_by_project_branch[project.id]?.main).toBe("Main Workspace")
    expect(state.workspace_alias_by_project_branch.project_missing).toBeUndefined()

    const fetched = await req({
      path: "/account/context/state",
      token,
    })
    expect(fetched.status).toBe(200)
    const persisted = (await fetched.json()) as { open_project_ids: string[] }
    expect(persisted.open_project_ids).toEqual([project.id])
  })

  test.skipIf(!on)("keeps the previous access token valid while selecting a new project context", async () => {
    const loginResult = await login("admin", "TpCode@2026")
    const admin = loginResult.access_token
    const projects = await req({
      path: "/account/context/projects",
      token: admin,
    })
    expect(projects.status).toBe(200)
    const payload = (await projects.json()) as {
      projects?: Array<{ id: string }>
    }
    const project = payload.projects?.[0]
    expect(!!project?.id).toBe(true)
    if (!project?.id) throw new Error("project_missing")

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: admin,
      body: { project_id: project.id },
    })
    expect(selected.status).toBe(200)

    const me = await req({
      path: "/account/me",
      token: admin,
    })
    expect(me.status).toBe(200)
  })

  test.skipIf(!on)("allows selecting an assigned project even when its worktree is unavailable on this machine", async () => {
    const loginResult = await login("admin", "TpCode@2026")
    const admin = loginResult.access_token
    const projects = await req({
      path: "/account/context/projects",
      token: admin,
    })
    expect(projects.status).toBe(200)
    const payload = (await projects.json()) as {
      projects?: Array<{ id: string; worktree: string }>
    }
    const project = payload.projects?.find((item) => item.id !== "global") ?? payload.projects?.[0]
    expect(!!project?.id).toBe(true)
    expect(!!project?.worktree).toBe(true)
    if (!project?.id || !project.worktree) throw new Error("project_missing")

    const missing = `/tmp/tpcode-missing-${uid("project")}`
    await Database.use((db) =>
      db.update(ProjectTable).set({ worktree: missing, time_updated: Date.now() }).where(eq(ProjectTable.id, project.id)).run(),
    )

    const selected = await req({
      path: "/account/context/select",
      method: "POST",
      token: admin,
      body: { project_id: project.id },
    })
    expect(selected.status).toBe(200)
    const body = (await selected.json()) as Record<string, unknown>
    const token = typeof body.access_token === "string" ? body.access_token : undefined
    expect(!!token).toBe(true)
    if (!token) throw new Error("token_missing")

    const me = await req({
      path: "/account/me",
      token,
    })
    expect(me.status).toBe(200)
    const user = (await me.json()) as { context_project_id?: string }
    expect(user.context_project_id).toBe(project.id)

    await Database.use((db) =>
      db.update(ProjectTable).set({ worktree: project.worktree, time_updated: Date.now() }).where(eq(ProjectTable.id, project.id)).run(),
    )
  })
})
