import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { resolveBuildCenterProducts, syncBuildCenterFilters } from "./settings-build-center-view"

type SolutionItem = {
  id: string
  name: string
  code: string
  enabled: boolean
}

type ProductItem = {
  id: string
  name: string
  project_id: string
  solutions?: SolutionItem[]
}

type SavedPlanItem = {
  id: string
  project_id: string
  project_name?: string
  session_title: string
  username: string
  display_name: string
  vho_feedback_no?: string
  plan_content: string
  time_created: number
  eval?: {
    status: string
    summary?: string
    user_score?: number
    assistant_score?: number
  }
}

type BuildArtifact = {
  id: string
  file_name: string
}

type BuildJobItem = {
  id: string
  status: string
  current_stage?: string
  source_type: string
  product_id: string
  solution_id: string
  plan_content?: string
  error_message?: string
  time_created: number
}

/** 中文注释：把未知值安全收窄为对象，便于读取接口返回。 */
function obj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

/** 中文注释：把未知值安全收窄为数组，避免前端直接消费异常响应。 */
function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

/** 中文注释：统一格式化时间展示，避免列表里出现原始时间戳。 */
function timeText(input: number) {
  if (!input) return "-"
  return new Date(input).toLocaleString()
}

/** 中文注释：管理端构建中心，集中展示计划、批量执行入口与构建任务结果。 */
export const SettingsBuildCenter = () => {
  const request = useAccountRequest()
  const server = useServer()
  let booted = false
  let loadToken = 0

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    keyword: "",
    products: [] as ProductItem[],
    product_id: "",
    solution_id: "",
    plans: [] as SavedPlanItem[],
    selected_plan_ids: [] as string[],
    jobs: [] as BuildJobItem[],
    artifacts: {} as Record<string, BuildArtifact[]>,
  })

  const currentProduct = createMemo(() => state.products.find((item) => item.id === state.product_id))
  const solutions = createMemo(() => currentProduct()?.solutions ?? [])

  /** 中文注释：统一按当前筛选条件刷新计划与构建任务列表，并阻止旧请求覆盖较新的用户选择。 */
  const load = async (next?: { product_id?: string; solution_id?: string; refresh_products?: boolean }) => {
    const token = ++loadToken
    setState("loading", true)
    setState("error", "")
    const refresh_products = next?.refresh_products ?? state.products.length === 0
    const incoming = refresh_products
      ? await (async () => {
          const response = await request({ path: "/account/admin/products" }).catch(() => undefined)
          if (!response?.ok) {
            if (token !== loadToken) return
            setState("loading", false)
            setState("error", await parseAccountError(response))
            return
          }
          return list<ProductItem>(await response.json().catch(() => undefined))
        })()
      : state.products
    if (token !== loadToken || !incoming) return
    const products = resolveBuildCenterProducts(state.products, incoming, refresh_products)
    const filters = syncBuildCenterFilters(products, next?.product_id ?? state.product_id, next?.solution_id ?? state.solution_id)
    const product_id = filters.product_id
    const solution_id = filters.solution_id
    setState("products", products)
    setState("product_id", product_id)
    setState("solution_id", solution_id)
    const query = new URLSearchParams()
    if (product_id) query.set("product_id", product_id)
    if (state.keyword.trim()) query.set("keyword", state.keyword.trim())
    query.set("limit", "100")
    const [planResponse, jobResponse] = await Promise.all([
      request({ path: `/account/admin/saved-plans?${query.toString()}` }).catch(() => undefined),
      request({
        path: `/build/job?${new URLSearchParams({
          ...(product_id ? { product_id } : {}),
          ...(solution_id ? { solution_id } : {}),
          limit: "100",
        }).toString()}`,
      }).catch(() => undefined),
    ])
    if (token !== loadToken) return
    setState("loading", false)
    if (!planResponse?.ok) {
      setState("error", await parseAccountError(planResponse))
      return
    }
    if (!jobResponse?.ok) {
      setState("error", await parseAccountError(jobResponse))
      return
    }
    const plans = list<SavedPlanItem>(await planResponse.json().catch(() => undefined))
    const jobs = list<BuildJobItem>(await jobResponse.json().catch(() => undefined))
    setState("plans", plans)
    setState("jobs", jobs)
    setState("selected_plan_ids", (ids) => ids.filter((item) => plans.some((plan) => plan.id === item)))
    const details = await Promise.all(
      jobs.slice(0, 20).map(async (item) => {
        const response = await request({ path: `/build/job/${encodeURIComponent(item.id)}` }).catch(() => undefined)
        if (!response?.ok) return
        const body = obj(await response.json().catch(() => undefined))
        return {
          job_id: item.id,
          artifacts: list<BuildArtifact>(body?.artifacts),
        }
      }),
    )
    if (token !== loadToken) return
    const artifacts = {} as Record<string, BuildArtifact[]>
    for (const item of details) {
      if (!item) continue
      artifacts[item.job_id] = item.artifacts
    }
    setState("artifacts", artifacts)
  }

  const togglePlan = (plan_id: string) => {
    setState("selected_plan_ids", (current) => (current.includes(plan_id) ? current.filter((item) => item !== plan_id) : [...current, plan_id]))
  }

  /** 中文注释：把当前选中的计划批量转成 build jobs，并立即进入后台执行。 */
  const runSelected = async () => {
    if (!state.product_id || state.selected_plan_ids.length === 0) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "POST",
      path: "/build/job/batch",
      body: {
        product_id: state.product_id,
        solution_id: state.solution_id || undefined,
        saved_plan_ids: state.selected_plan_ids,
        run_mode: "async",
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", `已提交 ${state.selected_plan_ids.length} 条计划，后台开始构建`)
    setState("selected_plan_ids", [])
    await load()
  }

  /** 中文注释：生成带 access_token 的产物下载地址，便于浏览器直接下载 zip。 */
  const artifactURL = (artifact_id: string) => {
    const current = server.current
    const token = AccountToken.access()
    if (!current || !token) return ""
    const url = new URL(`/build/artifact/${encodeURIComponent(artifact_id)}/file`, current.http.url)
    url.searchParams.set("access_token", token)
    return url.toString()
  }

  createEffect(() => {
    if (booted) return
    booted = true
    void load({ refresh_products: true })
  })

  createEffect(() => {
    const filters = syncBuildCenterFilters(state.products, state.product_id, state.solution_id)
    if (filters.product_id !== state.product_id) {
      setState("product_id", filters.product_id)
      return
    }
    if (filters.solution_id !== state.solution_id) {
      setState("solution_id", filters.solution_id)
    }
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-18-medium text-text-strong">构建中心</div>
            <div class="text-12-regular text-text-weak mt-1">从已保存计划批量生成 build job，统一跟踪编码、编译与打包结果。</div>
          </div>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load({ product_id: state.product_id, solution_id: state.solution_id, refresh_products: true })}
              disabled={state.loading || state.pending}
            >
              刷新
            </Button>
            <Button type="button" onClick={() => void runSelected()} disabled={state.pending || state.selected_plan_ids.length === 0 || !state.product_id}>
              {state.pending ? "提交中..." : `批量执行 (${state.selected_plan_ids.length})`}
            </Button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
          <select
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
            value={state.product_id}
            disabled={state.products.length === 0}
            onChange={(event) => {
              const product_id = event.currentTarget.value
              setState("product_id", product_id)
              setState("solution_id", "")
              void load({ product_id, solution_id: "" })
            }}
          >
            <For each={state.products}>
              {(item) => <option value={item.id}>{item.name}</option>}
            </For>
          </select>
          <select
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
            value={state.solution_id}
            disabled={solutions().length === 0}
            onChange={(event) => {
              const solution_id = event.currentTarget.value
              setState("solution_id", solution_id)
              void load({ product_id: state.product_id, solution_id })
            }}
          >
            <option value="">全部解决方案</option>
            <For each={solutions()}>
              {(item) => <option value={item.id}>{item.name}</option>}
            </For>
          </select>
          <input
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
            placeholder="按标题、反馈号、计划内容关键字筛选"
            value={state.keyword}
            onInput={(event) => setState("keyword", event.currentTarget.value)}
          />
        </div>

        <Show when={state.message}>
          <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
        </Show>
        <Show when={state.error}>
          <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
        </Show>

        <div class="grid gap-4 xl:grid-cols-2">
          <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong">已保存计划</div>
            <div class="max-h-[520px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">选择</th>
                    <th class="text-left px-3 py-2">标题</th>
                    <th class="text-left px-3 py-2">反馈号</th>
                    <th class="text-left px-3 py-2">评估</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.plans}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base align-top">
                        <td class="px-3 py-2">
                          <input type="checkbox" checked={state.selected_plan_ids.includes(item.id)} onChange={() => togglePlan(item.id)} />
                        </td>
                        <td class="px-3 py-2">
                          <div class="text-text-strong">{item.session_title || item.project_name || item.id}</div>
                          <div class="mt-1 text-text-weak line-clamp-3 whitespace-pre-wrap">{item.plan_content}</div>
                          <div class="mt-1 text-[11px] text-text-weak">{item.display_name} · {timeText(item.time_created)}</div>
                        </td>
                        <td class="px-3 py-2">{item.vho_feedback_no || "-"}</td>
                        <td class="px-3 py-2">{item.eval?.status || "pending"}</td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.plans.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={4}>
                        暂无可执行计划
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
          </div>

          <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong">构建任务</div>
            <div class="max-h-[520px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">状态</th>
                    <th class="text-left px-3 py-2">阶段</th>
                    <th class="text-left px-3 py-2">说明</th>
                    <th class="text-left px-3 py-2">产物</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.jobs}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base align-top">
                        <td class="px-3 py-2">
                          <div class="text-text-strong">{item.status}</div>
                          <div class="mt-1 text-[11px] text-text-weak">{timeText(item.time_created)}</div>
                        </td>
                        <td class="px-3 py-2">{item.current_stage || "-"}</td>
                        <td class="px-3 py-2">
                          <div class="line-clamp-3 whitespace-pre-wrap">{item.error_message || item.plan_content || "-"}</div>
                        </td>
                        <td class="px-3 py-2">
                          <div class="flex flex-col gap-1">
                            <For each={state.artifacts[item.id] ?? []}>
                              {(artifact) => (
                                <a class="text-icon-info-active underline" href={artifactURL(artifact.id)} target="_blank" rel="noreferrer">
                                  {artifact.file_name}
                                </a>
                              )}
                            </For>
                            <Show when={(state.artifacts[item.id] ?? []).length === 0}>
                              <span class="text-text-weak">-</span>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.jobs.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={4}>
                        暂无构建任务
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
