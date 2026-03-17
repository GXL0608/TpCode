import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import {
  createSolutionDraft,
  filterNamedSolutions,
  solutionLibraryItemClass,
  solutionLibraryLayoutClass,
  solutionLibrarySubmitDisabled,
  sortNamedSolutions,
  syncSolutionLibrarySelection,
  validateSolutionDraft,
} from "./settings-solution-library-view"

type ProductItem = {
  id: string
  name: string
  project_id?: string
  worktree?: string
}

type SolutionRootItem = {
  id?: string
  root_type: "single_repo" | "parent_batch" | "virtual_group"
  directory: string
  display_name?: string
  mount_name?: string
  sort_order?: number
  enabled?: boolean
  meta?: {
    directories?: string[]
  }
}

type SolutionItem = {
  id: string
  name: string
  code: string
  enabled: boolean
  build_profile: Record<string, unknown>
  roots: SolutionRootItem[]
  time_created: number
  time_updated: number
}

/** 中文注释：安全读取数组响应，避免后端异常结构直接污染页面状态。 */
function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

/** 中文注释：把未知响应收窄成普通对象，便于统一读取接口字段。 */
function obj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

/** 中文注释：统一读取接口错误码，兼容不同版本后端的返回字段。 */
async function code(response?: Response) {
  const payload = obj(await response?.clone().json().catch(() => undefined))
  const current = payload?.code
  if (typeof current === "string") return current
  const error = payload?.error
  if (typeof error === "string") return error
  return ""
}

/** 中文注释：把时间戳格式化为界面可读文本，便于管理员快速判断最近改动。 */
function timeText(input: number) {
  if (!input) return "-"
  return new Date(input).toLocaleString()
}

/** 中文注释：把配置对象格式化成可直接编辑的 JSON 字符串。 */
function pretty(input: unknown) {
  return JSON.stringify(input, null, 2)
}

/** 中文注释：独立维护全局解决方案库，供跨产品复用与统一编译配置管理。 */
export const SettingsSolutionLibrary = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    solutions: [] as SolutionItem[],
    solutionSearch: "",
    selectedSolutionID: "",
    formOpen: false,
    formEdit: false,
    formID: "",
    formName: "",
    formCode: "",
    formEnabled: true,
    formBuildProfileText: pretty({
      workdirs: ["."],
      compile_command: "",
      artifact_include: ["dist/**"],
      artifact_exclude: [],
      output_name_template: "{{solution}}.zip",
    }),
    formRootsText: pretty([
      {
        root_type: "single_repo",
        directory: "",
        display_name: "",
        mount_name: "",
        sort_order: 0,
        enabled: true,
      },
    ]),
  })
  /** 中文注释：按名称升序并结合关键字过滤方案导航，方便管理员在大量方案中快速定位。 */
  const visibleSolutions = createMemo(() => filterNamedSolutions(state.solutions, state.solutionSearch))

  const currentSolution = createMemo(() => state.solutions.find((item) => item.id === state.selectedSolutionID))

  const canManage = () => auth.has("role:manage")

  /** 中文注释：统一解析接口错误，兼容旧版本后端或网关误配场景。 */
  const resolveError = async (response?: Response) => {
    const current = await code(response)
    if (current !== "account_api_invalid_response") return parseAccountError(response)
    const probe = await request({ path: "/account/admin/roles?page=1&page_size=1" }).catch(() => undefined)
    if (probe?.ok) return "当前后端版本不支持解决方案库接口，请重启并升级后端服务后重试"
    return "当前后端不可用，请检查服务器地址并确认服务已启动"
  }

  /** 中文注释：统一加载全局方案库，解决方案与产品绑定已经解耦，这里不再依赖产品列表。 */
  const load = async () => {
    if (!canManage()) return
    setState("loading", true)
    setState("error", "")
    const solutionsResponse = await request({ path: "/account/admin/solutions" }).catch(() => undefined)
    setState("loading", false)
    if (!solutionsResponse?.ok) {
      setState("error", await resolveError(solutionsResponse))
      return
    }
    const solutionsBody = await solutionsResponse.json().catch(() => undefined)
    const solutions = sortNamedSolutions(list<SolutionItem>(solutionsBody))
    setState("solutions", solutions)
    setState("selectedSolutionID", syncSolutionLibrarySelection(solutions, state.selectedSolutionID))
  }

  /** 中文注释：打开新建方案表单，解决方案库新增时不再强制指定归属产品。 */
  const openCreate = () => {
    const draft = createSolutionDraft({
      id: "workspace",
      name: "workspace",
    })
    setState("formOpen", true)
    setState("formEdit", false)
    setState("formID", "")
    setState("formName", "")
    setState("formCode", "")
    setState("formEnabled", true)
    setState("formBuildProfileText", draft.build_profile_text)
    setState("formRootsText", draft.roots_text)
  }

  /** 中文注释：把当前方案回填到编辑表单，供管理员统一维护全局方案配置。 */
  const openEdit = (item: SolutionItem) => {
    setState("formOpen", true)
    setState("formEdit", true)
    setState("formID", item.id)
    setState("selectedSolutionID", item.id)
    setState("formName", item.name)
    setState("formCode", item.code)
    setState("formEnabled", item.enabled)
    setState("formBuildProfileText", pretty(item.build_profile))
    setState(
      "formRootsText",
      pretty(
        item.roots.map((root) => ({
          root_type: root.root_type,
          directory: root.directory,
          display_name: root.display_name,
          mount_name: root.mount_name,
          sort_order: root.sort_order ?? 0,
          enabled: root.enabled ?? true,
          meta: root.meta,
        })),
      ),
    )
  }

  /** 中文注释：关闭编辑面板并清理本次方案维护上下文。 */
  const closeForm = () => {
    if (state.pending) return
    setState("formOpen", false)
    setState("formEdit", false)
    setState("formID", "")
  }

  /** 中文注释：解析表单中的 JSON 文本，确保 roots 与 build_profile 在提交前就是合法结构。 */
  const parseForm = () => {
    try {
      const build_profile = JSON.parse(state.formBuildProfileText)
      const roots = JSON.parse(state.formRootsText)
      const message = validateSolutionDraft(build_profile, roots)
      if (message) return { ok: false as const, message }
      return {
        ok: true as const,
        body: {
          name: state.formName.trim(),
          code: state.formCode.trim(),
          enabled: state.formEnabled,
          build_profile,
          roots,
        },
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "解决方案 JSON 解析失败",
      }
    }
  }

  /** 中文注释：提交新建或编辑后的方案数据，并在成功后刷新全局方案库列表。 */
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    const parsed = parseForm()
    if (!parsed.ok) {
      setState("error", parsed.message)
      return
    }
    if (!parsed.body.name || !parsed.body.code) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: state.formEdit ? "PATCH" : "POST",
      path: state.formEdit
        ? `/account/admin/solutions/${encodeURIComponent(state.formID)}`
        : "/account/admin/solutions",
      body: parsed.body,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    const body = obj(await response.json().catch(() => undefined))
    const item = obj(body?.item)
    setState("message", state.formEdit ? "解决方案已更新" : "解决方案已创建")
    closeForm()
    await load()
    if (typeof item?.id === "string") setState("selectedSolutionID", item.id)
  }

  /** 中文注释：从全局方案库中彻底删除方案，供冗余历史方案清理场景使用。 */
  const remove = async (item: SolutionItem) => {
    if (!globalThis.confirm(`确认彻底删除解决方案「${item.name}」？这会同时解除所有产品绑定。`)) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/solutions/${encodeURIComponent(item.id)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    setState("message", "解决方案已删除")
    if (state.selectedSolutionID === item.id) setState("selectedSolutionID", "")
    await load()
  }

  /** 中文注释：切换左侧方案导航时退出当前编辑态，避免不同方案表单内容串联。 */
  const selectSolution = (item: SolutionItem) => {
    if (state.pending) return
    setState("selectedSolutionID", item.id)
    setState("formOpen", false)
    setState("formEdit", false)
    setState("formID", "")
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  createEffect(() => {
    const current = syncSolutionLibrarySelection(visibleSolutions(), state.selectedSolutionID)
    if (current !== state.selectedSolutionID) setState("selectedSolutionID", current)
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canManage()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有解决方案库管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-18-medium text-text-strong">解决方案库</div>
              <div class="text-12-regular text-text-weak mt-1">统一维护跨产品可复用的解决方案、源码根目录和编译打包配置。</div>
            </div>
            <div class="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
                刷新
              </Button>
              <Button type="button" onClick={openCreate} disabled={state.pending}>
                新增解决方案
              </Button>
            </div>
          </div>

          <Show when={state.message}>
            <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
          </Show>
          <Show when={state.error}>
            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
          </Show>

          <div class={solutionLibraryLayoutClass()}>
            <aside class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
              <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong flex items-center justify-between">
                <span>方案导航</span>
                <Show when={state.loading}>
                  <span class="text-12-regular text-text-weak">加载中...</span>
                </Show>
              </div>
              <div class="border-b border-border-weak-base px-3 py-3">
                <input
                  class="h-10 w-full rounded-md border border-border-weak-base bg-surface-panel/45 px-3 text-13-regular text-text-strong"
                  placeholder="检索方案名称"
                  value={state.solutionSearch}
                  onInput={(event) => setState("solutionSearch", event.currentTarget.value)}
                />
              </div>
              <div class="max-h-[720px] overflow-auto p-3 flex flex-col gap-2">
                <For each={visibleSolutions()}>
                  {(item) => (
                    <button
                      type="button"
                      class={`w-full rounded-xl border p-4 text-left transition-all ${solutionLibraryItemClass(state.selectedSolutionID === item.id)}`}
                      onClick={() => selectSolution(item)}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong break-all">{item.name}</div>
                          <div class="mt-1 text-11-regular break-all">{item.code}</div>
                        </div>
                        <div class="shrink-0 rounded-full px-2 py-1 text-11-medium" classList={{ "bg-icon-success-base/10 text-icon-success-base": item.enabled, "bg-icon-critical-base/10 text-icon-critical-base": !item.enabled }}>
                          {item.enabled ? "启用" : "停用"}
                        </div>
                      </div>
                      <div class="mt-3 flex flex-col gap-1 text-11-regular text-text-weak">
                        <span>目录数：{item.roots.length} · 更新于 {timeText(item.time_updated)}</span>
                      </div>
                    </button>
                  )}
                </For>
                <Show when={state.solutions.length === 0}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                    还没有解决方案，请先新增。
                  </div>
                </Show>
                <Show when={state.solutions.length > 0 && visibleSolutions().length === 0}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                    没有匹配的解决方案
                  </div>
                </Show>
              </div>
            </aside>

            <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
              <div class="px-4 py-3 border-b border-border-weak-base flex items-center justify-between gap-3">
                <div>
                  <div class="text-13-medium text-text-strong">{state.formOpen ? (state.formEdit ? "编辑解决方案" : "新增解决方案") : "解决方案详情"}</div>
                  <div class="mt-1 text-11-regular text-text-weak">
                    {state.formOpen
                      ? "在这里统一维护方案配置，保存后会自动刷新整个方案库。"
                      : "查看当前方案的默认项目、源码目录和编译打包规则。"}
                  </div>
                </div>
                <Show when={!state.formOpen && currentSolution()}>
                  <div class="flex gap-2">
                    <Button type="button" size="small" variant="secondary" onClick={() => currentSolution() && openEdit(currentSolution()!)} disabled={state.pending}>
                      编辑
                    </Button>
                    <Button type="button" size="small" variant="secondary" onClick={() => currentSolution() && void remove(currentSolution()!)} disabled={state.pending}>
                      删除
                    </Button>
                  </div>
                </Show>
              </div>
              <div class="p-4">
                <Show
                  when={state.formOpen}
                  fallback={
                    <Show
                      when={currentSolution()}
                      fallback={<div class="rounded-xl border border-dashed border-border-weak-base px-4 py-10 text-center text-12-regular text-text-weak">请选择一个解决方案，或者先新增解决方案。</div>}
                    >
                    <div class="flex flex-col gap-4">
                      <div class="grid gap-3 md:grid-cols-2">
                          <div class="rounded-xl bg-surface-panel/45 p-3">
                            <div class="text-11-medium text-text-weak">解决方案名称</div>
                            <div class="mt-2 text-13-medium text-text-strong break-all">{currentSolution()?.name}</div>
                          </div>
                          <div class="rounded-xl bg-surface-panel/45 p-3">
                            <div class="text-11-medium text-text-weak">解决方案编码</div>
                            <div class="mt-2 text-13-medium text-text-strong break-all">{currentSolution()?.code}</div>
                          </div>
                          <div class="rounded-xl bg-surface-panel/45 p-3">
                            <div class="text-11-medium text-text-weak">状态</div>
                            <div class="mt-2 text-12-regular text-text-strong">{currentSolution()?.enabled ? "启用" : "停用"}</div>
                          </div>
                          <div class="rounded-xl bg-surface-panel/45 p-3">
                            <div class="text-11-medium text-text-weak">更新时间</div>
                            <div class="mt-2 text-12-regular text-text-strong">{timeText(currentSolution()?.time_updated ?? 0)}</div>
                          </div>
                        </div>
                        <div class="rounded-xl bg-surface-panel/45 p-4">
                          <div class="text-12-medium text-text-strong">build_profile</div>
                          <pre class="mt-3 whitespace-pre-wrap break-all text-12-regular text-text-weak">{pretty(currentSolution()?.build_profile)}</pre>
                        </div>
                        <div class="rounded-xl bg-surface-panel/45 p-4">
                          <div class="text-12-medium text-text-strong">roots</div>
                          <pre class="mt-3 whitespace-pre-wrap break-all text-12-regular text-text-weak">{pretty(currentSolution()?.roots)}</pre>
                        </div>
                      </div>
                    </Show>
                  }
                >
                  <form class="flex flex-col gap-3" onSubmit={save}>
                    <div class="grid gap-3 md:grid-cols-2">
                      <input
                        class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                        placeholder="解决方案名称"
                        value={state.formName}
                        onInput={(event) => setState("formName", event.currentTarget.value)}
                      />
                      <input
                        class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                        placeholder="解决方案编码"
                        value={state.formCode}
                        onInput={(event) => setState("formCode", event.currentTarget.value)}
                      />
                      <label class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular flex items-center gap-2 md:col-span-2">
                        <input type="checkbox" checked={state.formEnabled} onChange={(event) => setState("formEnabled", event.currentTarget.checked)} />
                        启用该解决方案
                      </label>
                    </div>
                    <div class="rounded-xl bg-surface-panel/45 p-4 flex flex-col gap-2">
                      <div class="text-12-medium text-text-strong">build_profile JSON</div>
                      <div class="text-11-regular text-text-weak">
                        这里维护编译、打包和产物收集规则，当前仍使用 JSON 直接编辑。
                      </div>
                      <textarea
                        class="min-h-56 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-13-regular font-mono"
                        value={state.formBuildProfileText}
                        onInput={(event) => setState("formBuildProfileText", event.currentTarget.value)}
                      />
                    </div>
                    <div class="rounded-xl bg-surface-panel/45 p-4 flex flex-col gap-2">
                      <div class="text-12-medium text-text-strong">roots JSON</div>
                      <div class="text-11-regular text-text-weak">
                        `roots` 支持 `single_repo`、`parent_batch`、`virtual_group`，其中 `mount_name` 用于控制聚合工作区里的挂载目录名。
                      </div>
                      <textarea
                        class="min-h-64 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-13-regular font-mono"
                        value={state.formRootsText}
                        onInput={(event) => setState("formRootsText", event.currentTarget.value)}
                      />
                    </div>
                    <div class="flex justify-end gap-2">
                      <Button type="button" variant="secondary" onClick={closeForm} disabled={state.pending}>
                        取消
                      </Button>
                      <Button
                        type="submit"
                        disabled={solutionLibrarySubmitDisabled({
                          pending: state.pending,
                          name: state.formName,
                          code: state.formCode,
                        })}
                      >
                        {state.pending ? "保存中..." : "保存"}
                      </Button>
                    </div>
                  </form>
                </Show>
              </div>
            </div>
          </div>
        </section>
      </Show>
    </div>
  )
}
