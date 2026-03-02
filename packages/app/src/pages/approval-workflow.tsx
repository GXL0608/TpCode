import { Button } from "@opencode-ai/ui/button"
import { A } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { useAccountAuth } from "@/context/account-auth"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"

type Reviewer = {
  id: string
  username: string
  display_name: string
  org_id: string
  department_id?: string
  roles: string[]
  permissions: string[]
}

type Change = {
  id: string
  page_id?: string
  session_id?: string
  user_id: string
  org_id: string
  department_id?: string
  title: string
  description: string
  ai_plan?: string
  ai_prototype_url?: string
  ai_score?: number
  ai_revenue_assessment?: string
  status: string
  current_step: number
  time_created: number
  time_updated: number
}

type Approval = {
  id: string
  change_request_id: string
  reviewer_id: string
  step_order: number
  status: string
  comment?: string
  reviewed_at?: number
  time_created: number
}

type Timeline = {
  id: string
  change_request_id: string
  actor_id: string
  action: string
  detail?: string
  time_created: number
}

type ReviewItem = Approval & {
  change_request: Change
}

type Detail = {
  ok: boolean
  change_request: Change
  approvals: Approval[]
  timeline: Timeline[]
}

function json<T>(input: unknown): T | undefined {
  if (!input || typeof input !== "object") return
  return input as T
}

function date(ts?: number) {
  if (!ts) return "-"
  return DateTime.fromMillis(ts).toFormat("yyyy-LL-dd HH:mm:ss")
}

function changeStatus(status: string) {
  if (status === "draft") return "草稿"
  if (status === "confirmed") return "原型已确认"
  if (status === "pending_review") return "待审批"
  if (status === "approved") return "已通过"
  if (status === "rejected") return "已驳回"
  if (status === "executing") return "执行中"
  if (status === "completed") return "已完成"
  if (status === "cancelled") return "已取消"
  return status
}

function reviewStatus(status: string) {
  if (status === "pending") return "待审批"
  if (status === "approved") return "已通过"
  if (status === "rejected") return "已驳回"
  return status
}

function timelineAction(action: string) {
  if (action === "created") return "创建"
  if (action === "updated") return "更新"
  if (action === "confirmed") return "确认原型"
  if (action === "submitted") return "提交审批"
  if (action === "approved") return "审批通过"
  if (action === "rejected") return "审批驳回"
  if (action === "executing") return "标记执行中"
  if (action === "completed") return "标记已完成"
  return action
}

export default function ApprovalWorkflow() {
  const auth = useAccountAuth()
  const server = useServer()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    message: "",
    error: "",
    reviewers: [] as Reviewer[],
    changes: [] as Change[],
    reviews: [] as ReviewItem[],
    detail: undefined as Detail | undefined,
  })

  const [selectedID, setSelectedID] = createSignal("")
  const [sessionID, setSessionID] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [aiPlan, setAiPlan] = createSignal("")
  const [prototypeURL, setPrototypeURL] = createSignal("")
  const [aiScore, setAiScore] = createSignal("")
  const [aiRevenue, setAiRevenue] = createSignal("")
  const [reviewersSelected, setReviewersSelected] = createSignal<string[]>([])
  const [reviewComment, setReviewComment] = createSignal("")

  const canExecute = createMemo(() => auth.has("code:generate"))
  const canComplete = createMemo(() => auth.has("code:deploy"))
  const canReview = createMemo(
    () => auth.has("code:review") || auth.has("prototype:approve") || auth.has("session:update_any"),
  )

  const request = async (input: {
    path: string
    method?: string
    body?: Record<string, unknown>
  }) => {
    const current = server.current
    if (!current) return
    const endpoint = new URL(input.path, current.http.url).toString()
    const headers = new Headers()
    const token = AccountToken.access()
    if (token) headers.set("authorization", `Bearer ${token}`)
    if (input.body) headers.set("content-type", "application/json")
    const response = await fetcher(endpoint, {
      method: input.method ?? "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
    if (response.status !== 401 || !token) return response
    const refreshed = await AccountToken.refreshIfNeeded({
      baseUrl: current.http.url,
      fetcher,
    })
    if (!refreshed) return response
    const retry = new Headers(headers)
    retry.set("authorization", `Bearer ${refreshed}`)
    return fetcher(endpoint, {
      method: input.method ?? "GET",
      headers: retry,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
  }

  const fail = async (input: {
    title: string
    response?: Response
  }) => {
    setState("pending", false)
    setState("message", "")
    if (!input.response) {
      setState("error", input.title)
      return
    }
    const payload = json<{ error?: string; code?: string; message?: string }>(
      await input.response.json().catch(() => undefined),
    )
    const detail = payload?.message || payload?.code || payload?.error
    setState("error", detail ? `${input.title}: ${detail}` : input.title)
  }

  const done = (message: string) => {
    setState("pending", false)
    setState("error", "")
    setState("message", message)
  }

  const loadChanges = async () => {
    const response = await request({
      path: "/approval/change-request?limit=100",
    })
    if (!response?.ok) return
    const data = json<Change[]>(await response.json().catch(() => undefined))
    setState("changes", data ?? [])
  }

  const loadReviewers = async () => {
    const response = await request({
      path: "/approval/reviewer",
    })
    if (!response?.ok) return
    const data = json<Reviewer[]>(await response.json().catch(() => undefined))
    setState("reviewers", data ?? [])
  }

  const loadReviews = async () => {
    const response = await request({
      path: "/approval/review?status=pending&limit=100",
    })
    if (!response?.ok) return
    const data = json<ReviewItem[]>(await response.json().catch(() => undefined))
    setState("reviews", data ?? [])
  }

  const loadDetail = async (id: string) => {
    if (!id) {
      setState("detail", undefined)
      return
    }
    const response = await request({
      path: `/approval/change-request/${encodeURIComponent(id)}`,
    })
    if (!response?.ok) {
      setState("detail", undefined)
      return
    }
    const data = json<Detail>(await response.json().catch(() => undefined))
    setState("detail", data)
  }

  const refresh = async () => {
    if (!auth.authenticated()) return
    setState("loading", true)
    setState("error", "")
    await Promise.all([loadChanges(), loadReviewers(), loadReviews()])
    setState("loading", false)
    const current = selectedID()
    if (current) {
      await loadDetail(current)
      return
    }
    if (state.changes[0]?.id) {
      setSelectedID(state.changes[0].id)
      await loadDetail(state.changes[0].id)
    }
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void refresh()
  })

  const createChange = async (event: SubmitEvent) => {
    event.preventDefault()
    if (state.pending) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const score = aiScore().trim()
    const response = await request({
      path: "/approval/change-request",
      method: "POST",
      body: {
        session_id: sessionID().trim() || undefined,
        title: title().trim(),
        description: description().trim(),
        ai_plan: aiPlan().trim() || undefined,
        ai_prototype_url: prototypeURL().trim() || undefined,
        ai_score: score ? Number(score) : undefined,
        ai_revenue_assessment: aiRevenue().trim() || undefined,
      },
    })
    if (!response?.ok) return fail({ title: "创建变更单失败", response })
    const payload = json<{ ok: boolean; id?: string }>(await response.json().catch(() => undefined))
    if (!payload?.ok || !payload.id) return fail({ title: "创建变更单失败", response })
    done("创建成功")
    setSessionID("")
    setTitle("")
    setDescription("")
    setAiPlan("")
    setPrototypeURL("")
    setAiScore("")
    setAiRevenue("")
    setSelectedID(payload.id)
    await refresh()
  }

  const run = async (input: {
    path: string
    body?: Record<string, unknown>
    message: string
  }) => {
    if (state.pending) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      path: input.path,
      method: "POST",
      body: input.body ?? {},
    })
    if (!response?.ok) return fail({ title: `${input.message}失败`, response })
    done(input.message)
    setReviewComment("")
    await refresh()
  }

  const detail = createMemo(() => state.detail?.change_request)
  const selectedApprovals = createMemo(() => state.detail?.approvals ?? [])
  const selectedTimeline = createMemo(() => state.detail?.timeline ?? [])

  const toggleReviewer = (id: string) => {
    const current = reviewersSelected()
    if (current.includes(id)) {
      setReviewersSelected(current.filter((item) => item !== id))
      return
    }
    setReviewersSelected([...current, id])
  }

  return (
    <div class="min-h-screen w-full px-4 py-6">
      <div class="mx-auto w-full max-w-7xl flex flex-col gap-4">
        <div class="rounded-xl bg-surface-raised-base p-4 flex items-center justify-between">
          <div>
            <div class="text-20-medium text-text-strong">tpCode 审批流</div>
            <div class="text-12-regular text-text-weak">
              {"提示词 -> 计划 -> 原型 -> 确认 -> 审批 -> 执行 -> 完成"}
            </div>
          </div>
          <div class="flex items-center gap-2 text-12-regular">
            <A href="/settings/security" class="hover:text-text-strong">
              账号安全
            </A>
            <A href="/settings/apikeys" class="hover:text-text-strong">
              接口密钥
            </A>
            <Show
              when={
                auth.has("org:manage") ||
                auth.has("user:manage") ||
                auth.has("role:manage") ||
                auth.has("audit:view") ||
                auth.has("provider:config_global")
              }
            >
              <A href="/settings/account-admin" class="hover:text-text-strong">
                账号管理
              </A>
            </Show>
            <A href="/" class="hover:text-text-strong">
              返回
            </A>
          </div>
        </div>

        <Show when={state.message}>
          <div class="rounded-md bg-surface-panel px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
        </Show>
        <Show when={state.error}>
          <div class="rounded-md bg-surface-panel px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
        </Show>

        <Show when={state.loading}>
          <div class="rounded-xl bg-surface-raised-base p-4 text-12-regular text-text-weak">加载中...</div>
        </Show>

        <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
          <div class="text-16-medium text-text-strong">创建变更单</div>
          <form class="grid grid-cols-1 md:grid-cols-2 gap-2" onSubmit={createChange}>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="会话编号（可选）"
              value={sessionID()}
              onInput={(event) => setSessionID(event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="标题"
              value={title()}
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
            <textarea
              class="min-h-24 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular md:col-span-2"
              placeholder="需求描述"
              value={description()}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />
            <textarea
              class="min-h-24 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular"
              placeholder="智能计划（可选）"
              value={aiPlan()}
              onInput={(event) => setAiPlan(event.currentTarget.value)}
            />
            <textarea
              class="min-h-24 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular"
              placeholder="智能创收评估（可选）"
              value={aiRevenue()}
              onInput={(event) => setAiRevenue(event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="原型链接（可选）"
              value={prototypeURL()}
              onInput={(event) => setPrototypeURL(event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="智能评分（0-100，可选）"
              value={aiScore()}
              onInput={(event) => setAiScore(event.currentTarget.value)}
            />
            <div class="md:col-span-2">
              <Button type="submit" disabled={state.pending || !title().trim() || !description().trim()}>
                {state.pending ? "处理中..." : "创建"}
              </Button>
            </div>
          </form>
        </section>

        <div class="grid grid-cols-1 xl:grid-cols-[1.1fr_1.9fr] gap-4">
          <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
            <div class="text-16-medium text-text-strong">我可见范围内的变更单</div>
            <div class="max-h-[26rem] overflow-auto rounded-md border border-border-weak-base">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-2 py-1">编号</th>
                    <th class="text-left px-2 py-1">标题</th>
                    <th class="text-left px-2 py-1">状态</th>
                    <th class="text-left px-2 py-1">当前步骤</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.changes}>
                    {(item) => (
                      <tr
                        class="border-t border-border-weak-base cursor-pointer hover:bg-surface-panel"
                        classList={{
                          "bg-surface-panel": selectedID() === item.id,
                        }}
                        onClick={() => {
                          setSelectedID(item.id)
                          void loadDetail(item.id)
                        }}
                      >
                        <td class="px-2 py-1">{item.id.slice(0, 8)}</td>
                        <td class="px-2 py-1">{item.title}</td>
                        <td class="px-2 py-1">{changeStatus(item.status)}</td>
                        <td class="px-2 py-1">{item.current_step}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="text-14-medium text-text-strong">我的待审批任务</div>
            <div class="max-h-52 overflow-auto rounded-md border border-border-weak-base">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-2 py-1">审批单</th>
                    <th class="text-left px-2 py-1">变更单</th>
                    <th class="text-left px-2 py-1">步骤</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.reviews}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base">
                        <td class="px-2 py-1">{item.id.slice(0, 8)}</td>
                        <td class="px-2 py-1">
                          <button
                            class="underline-offset-2 hover:underline"
                            type="button"
                            onClick={() => {
                              setSelectedID(item.change_request_id)
                              void loadDetail(item.change_request_id)
                            }}
                          >
                            {item.change_request.title}
                          </button>
                        </td>
                        <td class="px-2 py-1">{item.step_order}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>

          <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
            <div class="text-16-medium text-text-strong">变更单详情</div>
            <Show when={detail()} fallback={<div class="text-12-regular text-text-weak">请先在左侧选择一个变更单。</div>}>
              <div class="rounded-md border border-border-weak-base p-3 text-12-regular flex flex-col gap-1">
                <div>
                  <span class="text-text-weak">编号：</span> {detail()!.id}
                </div>
                <div>
                  <span class="text-text-weak">标题：</span> {detail()!.title}
                </div>
                <div>
                  <span class="text-text-weak">状态：</span> {changeStatus(detail()!.status)}
                </div>
                <div>
                  <span class="text-text-weak">当前步骤：</span> {detail()!.current_step}
                </div>
                <div>
                  <span class="text-text-weak">会话：</span> {detail()!.session_id ?? "-"}
                </div>
                <div>
                  <span class="text-text-weak">创建时间：</span> {date(detail()!.time_created)}
                </div>
                <div>
                  <span class="text-text-weak">更新时间：</span> {date(detail()!.time_updated)}
                </div>
              </div>

              <div class="rounded-md border border-border-weak-base p-3 text-12-regular whitespace-pre-wrap">
                {detail()!.description}
              </div>

              <Show when={detail()!.ai_plan}>
                <div class="rounded-md border border-border-weak-base p-3 text-12-regular whitespace-pre-wrap">
                  {detail()!.ai_plan}
                </div>
              </Show>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <section class="rounded-md border border-border-weak-base p-3 flex flex-col gap-2">
                  <div class="text-14-medium text-text-strong">提交与生命周期动作</div>
                  <div class="text-12-regular text-text-weak">按顺序选择审批人；不选则走自审批。</div>
                  <div class="max-h-36 overflow-auto flex flex-col gap-1">
                    <For each={state.reviewers}>
                      {(item) => (
                        <label class="text-12-regular flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={reviewersSelected().includes(item.id)}
                            onChange={() => toggleReviewer(item.id)}
                          />
                          <span>{item.display_name} ({item.username})</span>
                        </label>
                      )}
                    </For>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={state.pending}
                      onClick={() =>
                        run({
                          path: `/approval/change-request/${encodeURIComponent(detail()!.id)}/confirm`,
                          message: "原型已确认",
                        })
                      }
                    >
                      确认原型
                    </Button>
                    <Button
                      type="button"
                      disabled={state.pending}
                      onClick={() =>
                        run({
                          path: `/approval/change-request/${encodeURIComponent(detail()!.id)}/submit`,
                          body: { reviewer_ids: reviewersSelected() },
                          message: "已提交审批",
                        })
                      }
                    >
                      提交审批
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={state.pending || !canExecute()}
                      onClick={() =>
                        run({
                          path: `/approval/change-request/${encodeURIComponent(detail()!.id)}/executing`,
                          message: "已标记执行中",
                        })
                      }
                    >
                      标记执行中
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={state.pending || !canComplete()}
                      onClick={() =>
                        run({
                          path: `/approval/change-request/${encodeURIComponent(detail()!.id)}/completed`,
                          message: "已标记完成",
                        })
                      }
                    >
                      标记完成
                    </Button>
                  </div>
                </section>

                <section class="rounded-md border border-border-weak-base p-3 flex flex-col gap-2">
                  <div class="text-14-medium text-text-strong">审批记录</div>
                  <input
                    class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                    placeholder="审批意见"
                    value={reviewComment()}
                    onInput={(event) => setReviewComment(event.currentTarget.value)}
                  />
                  <div class="max-h-44 overflow-auto rounded-md border border-border-weak-base">
                    <table class="w-full text-12-regular">
                      <thead class="bg-surface-panel">
                        <tr>
                          <th class="text-left px-2 py-1">步骤</th>
                          <th class="text-left px-2 py-1">审批人</th>
                          <th class="text-left px-2 py-1">状态</th>
                          <th class="text-left px-2 py-1">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={selectedApprovals()}>
                          {(item) => (
                            <tr class="border-t border-border-weak-base">
                              <td class="px-2 py-1">{item.step_order}</td>
                              <td class="px-2 py-1">{item.reviewer_id.slice(0, 8)}</td>
                              <td class="px-2 py-1">{reviewStatus(item.status)}</td>
                              <td class="px-2 py-1">
                                <Show
                                  when={
                                    item.status === "pending" &&
                                    (item.reviewer_id === auth.user()?.id || canReview())
                                  }
                                  fallback={<span>-</span>}
                                >
                                  <div class="flex gap-1">
                                    <Button
                                      type="button"
                                      size="small"
                                      variant="secondary"
                                      disabled={state.pending}
                                      onClick={() =>
                                        run({
                                          path: `/approval/review/${encodeURIComponent(item.id)}/approve`,
                                          body: { comment: reviewComment().trim() || undefined },
                                          message: "审批已通过",
                                        })
                                      }
                                    >
                                      通过
                                    </Button>
                                    <Button
                                      type="button"
                                      size="small"
                                      variant="secondary"
                                      disabled={state.pending || !reviewComment().trim()}
                                      onClick={() =>
                                        run({
                                          path: `/approval/review/${encodeURIComponent(item.id)}/reject`,
                                          body: { comment: reviewComment().trim() },
                                          message: "审批已驳回",
                                        })
                                      }
                                    >
                                      驳回
                                    </Button>
                                  </div>
                                </Show>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section class="rounded-md border border-border-weak-base p-3 flex flex-col gap-2">
                <div class="text-14-medium text-text-strong">流程时间线</div>
                <div class="max-h-52 overflow-auto rounded-md border border-border-weak-base">
                  <table class="w-full text-12-regular">
                    <thead class="bg-surface-panel">
                      <tr>
                        <th class="text-left px-2 py-1">时间</th>
                        <th class="text-left px-2 py-1">执行人</th>
                        <th class="text-left px-2 py-1">动作</th>
                        <th class="text-left px-2 py-1">详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={selectedTimeline()}>
                        {(item) => (
                          <tr class="border-t border-border-weak-base">
                            <td class="px-2 py-1">{date(item.time_created)}</td>
                            <td class="px-2 py-1">{item.actor_id.slice(0, 8)}</td>
                            <td class="px-2 py-1">{timelineAction(item.action)}</td>
                            <td class="px-2 py-1 whitespace-pre-wrap">{item.detail ?? "-"}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </section>
            </Show>
          </section>
        </div>
      </div>
    </div>
  )
}
