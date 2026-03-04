import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Flag } from "../../src/flag/flag"

const root = path.join(__dirname, "../..")
Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

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

beforeAll(async () => {
  if (!on) return
  const ready = await init()
  state.app = ready.app
  state.user = ready.user
})

describe("approval flow", () => {
  test.skipIf(!on)("multi-step review flows from submit to completed", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const pass = "TpCode@123A"
    const creator = uid("approval_creator")
    const reviewerA = uid("approval_reviewer_a")
    const reviewerB = uid("approval_reviewer_b")
    const createdCreator = await service.createUser({
      username: creator,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    const createdA = await service.createUser({
      username: reviewerA,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["dev_lead"],
      actor_user_id: "user_tp_admin",
    })
    const createdB = await service.createUser({
      username: reviewerB,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["pm"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdCreator.ok).toBe(true)
    expect(createdA.ok).toBe(true)
    expect(createdB.ok).toBe(true)
    if (!("id" in createdCreator) || !createdCreator.id) throw new Error("creator_id_missing")
    if (!("id" in createdA) || !createdA.id) throw new Error("reviewer_a_id_missing")
    if (!("id" in createdB) || !createdB.id) throw new Error("reviewer_b_id_missing")

    const creatorToken = await login(creator, pass)
    const reviewerAToken = await login(reviewerA, pass)
    const reviewerBToken = await login(reviewerB, pass)
    const adminToken = await login("admin", process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026")

    const sessionCreated = await req({
      path: "/session?directory=" + encodeURIComponent(root),
      method: "POST",
      token: creatorToken,
      body: { title: uid("approval_session") },
    })
    expect(sessionCreated.status).toBe(200)
    const session = (await sessionCreated.json()) as Record<string, unknown>
    const sessionID = typeof session.id === "string" ? session.id : ""
    expect(!!sessionID).toBe(true)

    const created = await req({
      path: "/approval/change-request",
      method: "POST",
      token: creatorToken,
      body: {
        session_id: sessionID,
        title: "Optimize outpatient queue display",
        description: "Reduce patient waiting anxiety and improve queue visibility",
        ai_plan: "Generate prototype then rollout by phases",
        ai_prototype_url: "https://example.com/prototype/1",
      },
    })
    expect(created.status).toBe(200)
    const createBody = (await created.json()) as Record<string, unknown>
    expect(createBody.ok).toBe(true)
    const changeID = typeof createBody.id === "string" ? createBody.id : ""
    expect(!!changeID).toBe(true)

    const submitted = await req({
      path: `/approval/change-request/${changeID}/submit`,
      method: "POST",
      token: creatorToken,
      body: {
        reviewer_ids: [createdA.id, createdB.id],
        ai_score: 86,
        ai_revenue_assessment: "Improves outpatient throughput and patient satisfaction",
      },
    })
    expect(submitted.status).toBe(200)
    const submitBody = (await submitted.json()) as Record<string, unknown>
    expect(submitBody.ok).toBe(true)
    expect(submitBody.status).toBe("pending_review")
    expect(submitBody.current_step).toBe(1)

    const detail = await req({
      path: `/approval/change-request/${changeID}`,
      token: creatorToken,
    })
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      ok: boolean
      change_request: Record<string, unknown>
      approvals: Array<Record<string, unknown>>
      timeline: Array<Record<string, unknown>>
    }
    expect(detailBody.ok).toBe(true)
    expect(detailBody.change_request.status).toBe("pending_review")
    expect(detailBody.approvals.length).toBe(2)
    const step1 = detailBody.approvals.find((item) => item.step_order === 1)
    const step2 = detailBody.approvals.find((item) => item.step_order === 2)
    const step1ID = typeof step1?.id === "string" ? step1.id : ""
    const step2ID = typeof step2?.id === "string" ? step2.id : ""
    expect(!!step1ID).toBe(true)
    expect(!!step2ID).toBe(true)

    const outOfOrder = await req({
      path: `/approval/review/${step2ID}/approve`,
      method: "POST",
      token: reviewerBToken,
      body: { comment: "Trying to approve step two first" },
    })
    expect(outOfOrder.status).toBe(400)
    const outBody = (await outOfOrder.json()) as Record<string, unknown>
    expect(outBody.code).toBe("not_current_step")

    const approved1 = await req({
      path: `/approval/review/${step1ID}/approve`,
      method: "POST",
      token: reviewerAToken,
      body: { comment: "Step one approved" },
    })
    expect(approved1.status).toBe(200)
    const approved1Body = (await approved1.json()) as Record<string, unknown>
    expect(approved1Body.ok).toBe(true)
    expect(approved1Body.status).toBe("pending_review")
    expect(approved1Body.current_step).toBe(2)

    const approved2 = await req({
      path: `/approval/review/${step2ID}/approve`,
      method: "POST",
      token: reviewerBToken,
      body: { comment: "Technical and business checks passed" },
    })
    expect(approved2.status).toBe(200)
    const approved2Body = (await approved2.json()) as Record<string, unknown>
    expect(approved2Body.ok).toBe(true)
    expect(approved2Body.status).toBe("approved")

    const executing = await req({
      path: `/approval/change-request/${changeID}/executing`,
      method: "POST",
      token: creatorToken,
      body: {},
    })
    expect(executing.status).toBe(200)

    const completed = await req({
      path: `/approval/change-request/${changeID}/completed`,
      method: "POST",
      token: adminToken,
      body: {},
    })
    expect(completed.status).toBe(200)

    const final = await req({
      path: `/approval/change-request/${changeID}`,
      token: creatorToken,
    })
    expect(final.status).toBe(200)
    const finalBody = (await final.json()) as {
      ok: boolean
      change_request: Record<string, unknown>
      timeline: Array<Record<string, unknown>>
    }
    expect(finalBody.ok).toBe(true)
    expect(finalBody.change_request.status).toBe("completed")
    expect(finalBody.timeline.some((item) => item.action === "submitted")).toBe(true)
    expect(finalBody.timeline.some((item) => item.action === "approved")).toBe(true)
    expect(finalBody.timeline.some((item) => item.action === "executing")).toBe(true)
    expect(finalBody.timeline.some((item) => item.action === "completed")).toBe(true)
  })

  test.skipIf(!on)("submit without reviewers falls back to self review", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const pass = "TpCode@123A"
    const creator = uid("approval_self_creator")
    const createdCreator = await service.createUser({
      username: creator,
      password: pass,
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(createdCreator.ok).toBe(true)
    if (!("id" in createdCreator) || !createdCreator.id) throw new Error("creator_id_missing")

    const token = await login(creator, pass)
    const sessionCreated = await req({
      path: "/session?directory=" + encodeURIComponent(root),
      method: "POST",
      token,
      body: { title: uid("self_review_session") },
    })
    expect(sessionCreated.status).toBe(200)
    const session = (await sessionCreated.json()) as Record<string, unknown>
    const sessionID = typeof session.id === "string" ? session.id : ""
    expect(!!sessionID).toBe(true)

    const created = await req({
      path: "/approval/change-request",
      method: "POST",
      token,
      body: {
        session_id: sessionID,
        title: "Self review path",
        description: "Developer handles request directly",
      },
    })
    expect(created.status).toBe(200)
    const createBody = (await created.json()) as Record<string, unknown>
    const changeID = typeof createBody.id === "string" ? createBody.id : ""
    expect(!!changeID).toBe(true)

    const submitted = await req({
      path: `/approval/change-request/${changeID}/submit`,
      method: "POST",
      token,
      body: {},
    })
    expect(submitted.status).toBe(200)
    const submitBody = (await submitted.json()) as Record<string, unknown>
    expect(submitBody.ok).toBe(true)
    expect(submitBody.status).toBe("approved")

    const detail = await req({
      path: `/approval/change-request/${changeID}`,
      token,
    })
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      ok: boolean
      change_request: Record<string, unknown>
      approvals: Array<Record<string, unknown>>
    }
    expect(detailBody.ok).toBe(true)
    expect(detailBody.change_request.status).toBe("approved")
    expect(detailBody.approvals.length).toBe(1)
    expect(detailBody.approvals[0]?.reviewer_id).toBe(createdCreator.id)
    expect(detailBody.approvals[0]?.status).toBe("approved")
  })
})
