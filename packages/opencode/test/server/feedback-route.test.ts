import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../../src/util/log"
import { Flag } from "../../src/flag/flag"
import { Project } from "../../src/project/project"
import { AccountContextService } from "../../src/user/context"
import { AccountProductService } from "../../src/user/product"

const root = path.join(__dirname, "../..")
Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED && Flag.TPCODE_FEEDBACK_ENABLED

async function init() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), user: UserService }
}

const state = {
  app: undefined as Awaited<ReturnType<typeof init>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof init>>["user"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

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

beforeAll(async () => {
  if (!on) return
  const ready = await init()
  state.app = ready.app
  state.user = ready.user
})

describe("feedback forum routes", () => {
  test.skipIf(!on)("creates, replies, resolves, and isolates by project context", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const pass = "TpCode@123A"
    const creator = uid("feedback_creator")
    const manager = uid("feedback_manager")
    const outsider = uid("feedback_outsider")

    const createdCreator = await service.createUser({
      username: creator,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    const createdManager = await service.createUser({
      username: manager,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["pm"],
      actor_user_id: "user_tp_admin",
    })
    const createdOutsider = await service.createUser({
      username: outsider,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["ops"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdCreator.ok).toBe(true)
    expect(createdManager.ok).toBe(true)
    expect(createdOutsider.ok).toBe(true)
    if (!("id" in createdCreator) || !createdCreator.id) throw new Error("creator_id_missing")
    if (!("id" in createdManager) || !createdManager.id) throw new Error("manager_id_missing")
    if (!("id" in createdOutsider) || !createdOutsider.id) throw new Error("outsider_id_missing")

    const primary = await Project.fromDirectory(root)
    const primarySet = await AccountContextService.setRoleAccess({
      project_id: primary.project.id,
      role_codes: ["developer", "pm"],
    })
    expect(primarySet.ok).toBe(true)

    const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-feedback-"))
    const secondary = await AccountProductService.create({
      name: uid("feedback_product"),
      directory: temp,
    })
    expect(secondary.ok).toBe(true)
    if (!secondary.ok) throw new Error("secondary_project_missing")

    const secondarySet = await AccountContextService.setRoleAccess({
      project_id: secondary.item.project_id,
      role_codes: ["ops"],
    })
    expect(secondarySet.ok).toBe(true)

    const creatorSession = await service.selectContext({
      user_id: createdCreator.id,
      project_id: primary.project.id,
    })
    const managerSession = await service.selectContext({
      user_id: createdManager.id,
      project_id: primary.project.id,
    })
    const outsiderSession = await service.selectContext({
      user_id: createdOutsider.id,
      project_id: secondary.item.project_id,
    })
    expect(creatorSession.ok).toBe(true)
    expect(managerSession.ok).toBe(true)
    expect(outsiderSession.ok).toBe(true)
    if (!creatorSession.ok || !managerSession.ok || !outsiderSession.ok) throw new Error("session_missing")
    const creatorToken = creatorSession.access_token
    const managerToken = managerSession.access_token
    const outsiderToken = outsiderSession.access_token

    const created = await req({
      path: "/feedback/threads",
      method: "POST",
      token: creatorToken,
      body: {
        title: "移动端论坛弹窗样式异常",
        content: "手机端点击反馈后，列表和详情切换不够清晰。",
        page_name: "会话页",
        menu_path: "/session",
        source_platform: "mobile_web",
      },
    })
    expect(created.status).toBe(200)
    const createdBody = (await created.json()) as {
      ok: boolean
      thread: Thread
    }
    expect(createdBody.ok).toBe(true)
    expect(createdBody.thread.status).toBe("open")
    const thread_id = createdBody.thread.id

    const listed = await req({
      path: "/feedback/threads?status=open",
      token: creatorToken,
    })
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as Thread[]
    expect(listBody.some((item) => item.id === thread_id)).toBe(true)

    const reply = await req({
      path: `/feedback/threads/${thread_id}/posts`,
      method: "POST",
      token: creatorToken,
      body: {
        content: "补充一下，切到详情后回复框应该固定在底部。",
      },
    })
    expect(reply.status).toBe(200)
    const replyBody = (await reply.json()) as {
      ok: boolean
      post: Post
    }
    expect(replyBody.ok).toBe(true)
    expect(replyBody.post.official_reply).toBe(false)

    const forbidden = await req({
      path: `/feedback/threads/${thread_id}/status`,
      method: "PATCH",
      token: creatorToken,
      body: {
        status: "resolved",
      },
    })
    expect(forbidden.status).toBe(403)

    const processing = await req({
      path: `/feedback/threads/${thread_id}/status`,
      method: "PATCH",
      token: managerToken,
      body: {
        status: "processing",
      },
    })
    expect(processing.status).toBe(200)

    const managerReply = await req({
      path: `/feedback/threads/${thread_id}/posts`,
      method: "POST",
      token: managerToken,
      body: {
        content: "已收到，前端会改成手机端全屏弹层。",
      },
    })
    expect(managerReply.status).toBe(200)
    const managerReplyBody = (await managerReply.json()) as {
      ok: boolean
      post: Post
    }
    expect(managerReplyBody.ok).toBe(true)
    expect(managerReplyBody.post.official_reply).toBe(true)

    const resolved = await req({
      path: `/feedback/threads/${thread_id}/status`,
      method: "PATCH",
      token: managerToken,
      body: {
        status: "resolved",
      },
    })
    expect(resolved.status).toBe(200)
    const resolvedBody = (await resolved.json()) as {
      ok: boolean
      thread: Thread
    }
    expect(resolvedBody.ok).toBe(true)
    expect(resolvedBody.thread.status).toBe("resolved")
    expect(!!resolvedBody.thread.resolved_name).toBe(true)

    const detail = await req({
      path: `/feedback/threads/${thread_id}`,
      token: creatorToken,
    })
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as Detail
    expect(detailBody.ok).toBe(true)
    expect(detailBody.posts.length).toBe(2)

    const hiddenList = await req({
      path: "/feedback/threads",
      token: outsiderToken,
    })
    expect(hiddenList.status).toBe(200)
    const hiddenListBody = (await hiddenList.json()) as Thread[]
    expect(hiddenListBody.some((item) => item.id === thread_id)).toBe(false)

    const hiddenDetail = await req({
      path: `/feedback/threads/${thread_id}`,
      token: outsiderToken,
    })
    expect(hiddenDetail.status).toBe(404)

    const hiddenReply = await req({
      path: `/feedback/threads/${thread_id}/posts`,
      method: "POST",
      token: outsiderToken,
      body: {
        content: "我不应该看到这条帖子。",
      },
    })
    expect(hiddenReply.status).toBe(404)
  })
})

type Thread = {
  id: string
  status: "open" | "processing" | "resolved"
  resolved_name?: string
}

type Post = {
  id: string
  official_reply: boolean
}

type Detail = {
  ok: true
  posts: Post[]
}
