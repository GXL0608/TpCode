import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { buildSummaryLine, buildScopeText, collectBuildSolutionCodes } from "./build-job-summary"
import { buildStageGroups, buildStageLabel, syncBuildCenterJobSelection } from "./settings-build-center-detail"
import { buildBuildCenterJobBody, buildBuildCenterModelOptions } from "./settings-build-center-model"
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

type BuildStage = {
  id: string
  stage: string
  status: string
  detail_json?: Record<string, unknown>
  error_message?: string
}

type BuildJobItem = {
  id: string
  status: string
  current_stage?: string
  source_type: string
  product_id: string
  solution_scope?: string
  solution_id: string
  runtime_provider_id?: string
  runtime_model_id?: string
  plan_content?: string
  error_message?: string
  time_created: number
}

type SelectableModel = {
  value?: string
  source?: string
}

type BuildJobDetail = {
  stages: BuildStage[]
  artifacts: BuildArtifact[]
}

type BuildJobBatchResult = {
  jobs?: BuildJobItem[]
  created_count?: number
  reused_count?: number
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
    model_value: "__auto__",
    model_options: [{ value: "__auto__", label: "系统自动" }] as Array<{ value: string; label: string }>,
    products: [] as ProductItem[],
    product_id: "",
    solution_id: "",
    plans: [] as SavedPlanItem[],
    selected_plan_ids: [] as string[],
    jobs: [] as BuildJobItem[],
    selected_job_id: "",
    detail_loading_id: "",
    details: {} as Record<string, BuildJobDetail>,
  })

  const currentProduct = createMemo(() => state.products.find((item) => item.id === state.product_id))
  const solutions = createMemo(() => currentProduct()?.solutions ?? [])
  const selectedJob = createMemo(() => state.jobs.find((item) => item.id === state.selected_job_id))
  const selectedDetail = createMemo(() => (state.selected_job_id ? state.details[state.selected_job_id] : undefined))

  /** 中文注释：统一按当前筛选条件刷新计划与构建任务列表，并阻止旧请求覆盖较新的用户选择。 */
  const load = async (next?: { product_id?: string; solution_id?: string; refresh_products?: boolean }) => {
    const token = ++loadToken
    setState("loading", true)
    setState("error", "")
    const refresh_products = next?.refresh_products ?? state.products.length === 0
    const [incoming, catalog] = await Promise.all([
      refresh_products
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
        : state.products,
      request({ path: "/account/me/providers/catalog" })
        .then((response) => (response?.ok ? response.json().catch(() => undefined) : undefined))
        .catch(() => undefined),
    ])
    if (token !== loadToken || !incoming) return
    const options = buildBuildCenterModelOptions(list<SelectableModel>(obj(catalog)?.selectable_models))
    const products = resolveBuildCenterProducts(state.products, incoming, refresh_products)
    const filters = syncBuildCenterFilters(products, next?.product_id ?? state.product_id, next?.solution_id ?? state.solution_id)
    const product_id = filters.product_id
    const solution_id = filters.solution_id
    setState("products", products)
    setState("product_id", product_id)
    setState("solution_id", solution_id)
    setState("model_options", options)
    if (!options.some((item) => item.value === state.model_value)) setState("model_value", "__auto__")
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
        return [
          item.id,
          {
            stages: list<BuildStage>(body?.stages),
            artifacts: list<BuildArtifact>(body?.artifacts),
          } satisfies BuildJobDetail,
        ] as const
      }),
    )
    if (token !== loadToken) return
    const detailsByJob = {} as Record<string, BuildJobDetail>
    for (const item of details) {
      if (!item) continue
      detailsByJob[item[0]] = item[1]
    }
    setState("details", detailsByJob)
    setState("selected_job_id", syncBuildCenterJobSelection(jobs, state.selected_job_id))
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
      body: buildBuildCenterJobBody({
        product_id: state.product_id,
        solution_id: state.solution_id,
        saved_plan_ids: state.selected_plan_ids,
        model: state.model_value,
      }),
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const body = obj(await response.json().catch(() => undefined)) as BuildJobBatchResult | undefined
    const created_count = typeof body?.created_count === "number" ? body.created_count : state.selected_plan_ids.length
    const reused_count = typeof body?.reused_count === "number" ? body.reused_count : 0
    setState(
      "message",
      reused_count > 0
        ? `已提交 ${created_count} 条新计划，复用 ${reused_count} 条执行中的任务，后台开始构建`
        : `已提交 ${created_count} 条计划，后台开始构建`,
    )
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

  /** 中文注释：读取指定任务的详情快照，供列表摘要和产物下载统一复用。 */
  const detail = (job_id: string) => state.details[job_id]

  /** 中文注释：提取任务详情中的方案编码摘要，便于列表直接显示本次覆盖范围。 */
  const solutionText = (job_id: string) => {
    const codes = collectBuildSolutionCodes(detail(job_id)?.stages)
    if (codes.length === 0) return ""
    return codes.join("、")
  }

  /** 中文注释：把阶段原始 detail_json 转成可读文本，作为没有方案明细时的兜底展示。 */
  const detailText = (stage: BuildStage) => {
    const payload = stage.detail_json
    if (!payload || Object.keys(payload).length === 0) return ""
    return JSON.stringify(payload, null, 2)
  }

  /** 中文注释：按需加载单个构建任务的详情，便于列表选中后再查看完整阶段明细。 */
  const loadJobDetail = async (job_id: string) => {
    if (!job_id || state.details[job_id] || state.detail_loading_id === job_id) return
    setState("detail_loading_id", job_id)
    const response = await request({ path: `/build/job/${encodeURIComponent(job_id)}` }).catch(() => undefined)
    if (!response?.ok) {
      if (state.detail_loading_id === job_id) setState("detail_loading_id", "")
      return
    }
    const body = obj(await response.json().catch(() => undefined))
    setState("details", job_id, {
      stages: list<BuildStage>(body?.stages),
      artifacts: list<BuildArtifact>(body?.artifacts),
    })
    if (state.detail_loading_id === job_id) setState("detail_loading_id", "")
  }

  /** 中文注释：切换构建任务选中态，并在首次查看时补拉详情数据。 */
  const selectJob = (job_id: string) => {
    setState("selected_job_id", job_id)
    void loadJobDetail(job_id)
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

  createEffect(() => {
    const job_id = syncBuildCenterJobSelection(state.jobs, state.selected_job_id)
    if (job_id !== state.selected_job_id) {
      setState("selected_job_id", job_id)
      return
    }
    if (job_id && !selectedDetail()) {
      void loadJobDetail(job_id)
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

        <div class="grid gap-3 md:grid-cols-[220px_220px_220px_minmax(0,1fr)]">
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
          <select
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
            value={state.model_value}
            onChange={(event) => setState("model_value", event.currentTarget.value)}
          >
            <For each={state.model_options}>
              {(item) => <option value={item.value}>{item.label}</option>}
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
                      <tr
                        class="border-t border-border-weak-base align-top cursor-pointer transition-colors"
                        classList={{
                          "bg-brand-solid/10": state.selected_job_id === item.id,
                          "hover:bg-surface-panel/45": state.selected_job_id !== item.id,
                        }}
                        onClick={() => selectJob(item.id)}
                      >
                        <td class="px-3 py-2">
                          <div class="text-text-strong">{item.status}</div>
                          <div class="mt-1 text-[11px] text-text-weak">{buildSummaryLine({ solution_scope: item.solution_scope, ...(detail(item.id) ?? {}) })}</div>
                          <div class="mt-1 text-[11px] text-text-weak">{timeText(item.time_created)}</div>
                        </td>
                        <td class="px-3 py-2">
                          <div>{item.current_stage || "-"}</div>
                          <Show when={detail(item.id)?.stages?.length}>
                            <div class="mt-1 text-[11px] text-text-weak">
                              {(detail(item.id)?.stages ?? []).map((stage) => `${stage.stage}:${stage.status}`).join(" / ")}
                            </div>
                          </Show>
                        </td>
                        <td class="px-3 py-2">
                          <Show when={buildScopeText(item.solution_scope) !== buildSummaryLine({ solution_scope: item.solution_scope, ...(detail(item.id) ?? {}) })}>
                            <div class="mb-1 text-[11px] text-text-weak">
                              {buildScopeText(item.solution_scope)}{solutionText(item.id) ? ` 已覆盖 ${solutionText(item.id)}` : ""}
                            </div>
                          </Show>
                          <div class="line-clamp-3 whitespace-pre-wrap">{item.error_message || item.plan_content || "-"}</div>
                        </td>
                        <td class="px-3 py-2">
                          <div class="flex flex-col gap-1">
                            <For each={detail(item.id)?.artifacts ?? []}>
                              {(artifact) => (
                                <a class="text-icon-info-active underline" href={artifactURL(artifact.id)} target="_blank" rel="noreferrer">
                                  {artifact.file_name}
                                </a>
                              )}
                            </For>
                            <Show when={(detail(item.id)?.artifacts ?? []).length === 0}>
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

        <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
          <div class="px-4 py-3 border-b border-border-weak-base flex items-center justify-between gap-3">
            <div>
              <div class="text-13-medium text-text-strong">任务详情</div>
              <div class="mt-1 text-11-regular text-text-weak">查看当前选中构建任务的阶段结果、方案级日志和打包产物。</div>
            </div>
            <Show when={selectedJob()}>
              <div class="text-11-regular text-text-weak">{selectedJob()?.id}</div>
            </Show>
          </div>
          <div class="p-4">
            <Show
              when={selectedJob()}
              fallback={<div class="rounded-xl border border-dashed border-border-weak-base px-4 py-10 text-center text-12-regular text-text-weak">请选择一条构建任务后查看详情。</div>}
            >
              <div class="flex flex-col gap-4">
                <div class="grid gap-3 md:grid-cols-4">
                  <div class="rounded-xl bg-surface-panel/45 p-3">
                    <div class="text-11-medium text-text-weak">执行范围</div>
                    <div class="mt-2 text-12-regular text-text-strong">{buildSummaryLine({ solution_scope: selectedJob()?.solution_scope, ...(selectedDetail() ?? {}) })}</div>
                  </div>
                  <div class="rounded-xl bg-surface-panel/45 p-3">
                    <div class="text-11-medium text-text-weak">当前阶段</div>
                    <div class="mt-2 text-12-regular text-text-strong">{selectedJob()?.current_stage || "-"}</div>
                  </div>
                  <div class="rounded-xl bg-surface-panel/45 p-3">
                    <div class="text-11-medium text-text-weak">来源类型</div>
                    <div class="mt-2 text-12-regular text-text-strong">{selectedJob()?.source_type || "-"}</div>
                  </div>
                  <div class="rounded-xl bg-surface-panel/45 p-3">
                    <div class="text-11-medium text-text-weak">执行模型</div>
                    <div class="mt-2 text-12-regular text-text-strong">
                      {selectedJob()?.runtime_provider_id && selectedJob()?.runtime_model_id
                        ? `${selectedJob()!.runtime_provider_id}/${selectedJob()!.runtime_model_id}`
                        : "系统自动"}
                    </div>
                  </div>
                  <div class="rounded-xl bg-surface-panel/45 p-3">
                    <div class="text-11-medium text-text-weak">创建时间</div>
                    <div class="mt-2 text-12-regular text-text-strong">{timeText(selectedJob()?.time_created ?? 0)}</div>
                  </div>
                </div>

                <Show when={selectedJob()?.plan_content}>
                  <div class="rounded-xl bg-surface-panel/45 p-4">
                    <div class="text-12-medium text-text-strong">计划/需求快照</div>
                    <pre class="mt-3 whitespace-pre-wrap break-all text-12-regular text-text-weak">{selectedJob()?.plan_content}</pre>
                  </div>
                </Show>

                <Show when={state.detail_loading_id === state.selected_job_id && !selectedDetail()}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                    正在加载任务详情...
                  </div>
                </Show>

                <Show when={(selectedDetail()?.stages ?? []).length > 0}>
                  <div class="grid gap-3 xl:grid-cols-2">
                    <For each={selectedDetail()?.stages ?? []}>
                      {(stage) => (
                        <div class="rounded-xl border border-border-weak-base bg-surface-panel/35 p-4 flex flex-col gap-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-13-medium text-text-strong">{buildStageLabel(stage.stage)}</div>
                            <div class="text-11-medium text-text-weak">{stage.status}</div>
                          </div>
                          <Show when={stage.error_message}>
                            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{stage.error_message}</div>
                          </Show>
                          <Show
                            when={buildStageGroups(stage).length > 0}
                            fallback={
                              <Show when={detailText(stage)}>
                                <pre class="rounded-md bg-surface-base px-3 py-2 whitespace-pre-wrap break-all text-11-regular text-text-weak">{detailText(stage)}</pre>
                              </Show>
                            }
                          >
                            <div class="flex flex-col gap-3">
                              <For each={buildStageGroups(stage)}>
                                {(group) => (
                                  <div class="rounded-lg bg-surface-base px-3 py-3">
                                    <div class="text-12-medium text-text-strong">{group.name}</div>
                                    <div class="mt-2 flex flex-col gap-1">
                                      <For each={group.lines}>
                                        {(line) => <div class="text-11-regular text-text-weak break-all">{line}</div>}
                                      </For>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={(selectedDetail()?.artifacts ?? []).length > 0}>
                  <div class="rounded-xl bg-surface-panel/45 p-4">
                    <div class="text-12-medium text-text-strong">当前产物</div>
                    <div class="mt-3 flex flex-col gap-2">
                      <For each={selectedDetail()?.artifacts ?? []}>
                        {(artifact) => (
                          <a class="text-icon-info-active underline break-all" href={artifactURL(artifact.id)} target="_blank" rel="noreferrer">
                            {artifact.file_name}
                          </a>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </section>
    </div>
  )
}
