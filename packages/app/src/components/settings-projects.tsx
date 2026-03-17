import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import {
  filterNamedItems,
  productItemClass,
  projectsLayoutClass,
  projectsSolutionLayoutClass,
  solutionItemClass,
  syncProductSelection,
  syncSolutionSelection,
} from "./settings-projects-view"

type ProductItem = {
  id: string
  name: string
  project_id?: string
  worktree?: string
  vcs?: string
  solutions?: SolutionItem[]
  time_created: number
  time_updated: number
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
  primary_project_id?: string
  build_profile: Record<string, unknown>
  roots: SolutionRootItem[]
  time_created: number
  time_updated: number
}

type ScanDirEntry = {
  path: string
  name: string
}

/** 中文注释：安全读取数组类型接口响应，避免页面直接消费异常值。 */
function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

/** 中文注释：把未知值收窄成普通对象，便于读取接口字段。 */
function obj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

/** 中文注释：统一提取接口返回的错误码文本，供权限探测和兼容提示复用。 */
async function code(response?: Response) {
  const payload = obj(await response?.clone().json().catch(() => undefined))
  const code = payload?.code
  if (typeof code === "string") return code
  const error = payload?.error
  if (typeof error === "string") return error
  return ""
}

/** 中文注释：把时间戳格式化为界面友好的本地时间文本。 */
function timeText(input: number) {
  if (!input) return "-"
  return new Date(input).toLocaleString()
}

/** 中文注释：把对象格式化为可编辑 JSON 文本，供配置面板直接展示。 */
function pretty(input: unknown) {
  return JSON.stringify(input, null, 2)
}

export const SettingsProjects = (props: { onOpenSolutionLibrary?: () => void }) => {
  const auth = useAccountAuth()
  const request = useAccountRequest()

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    products: [] as ProductItem[],
    productSearch: "",
    selectedProductID: "",
    selectedSolutionID: "",
    createOpen: false,
    editOpen: false,
    formID: "",
    formName: "",
    formDirectory: "",
    solutionLibraryOpen: false,
    solutionLibraryLoading: false,
    solutionLibraryProductID: "",
    solutionLibrary: [] as SolutionItem[],
    scanTarget: "create" as "create" | "edit",
    scanDirOpen: false,
    scanDirLoading: false,
    scanDirCurrent: "",
    scanDirParent: "",
    scanDirEntries: [] as ScanDirEntry[],
  })
  /** 中文注释：按名称升序并结合关键字过滤产品导航，方便管理员在大量产品中快速定位。 */
  const visibleProducts = createMemo(() => filterNamedItems(state.products, state.productSearch))
  const currentProduct = createMemo(() => state.products.find((item) => item.id === state.selectedProductID))
  const currentSolution = createMemo(() => currentProduct()?.solutions?.find((item) => item.id === state.selectedSolutionID))
  const bindableSolutions = createMemo(() => {
    const product = state.products.find((item) => item.id === state.solutionLibraryProductID)
    const bound = new Set((product?.solutions ?? []).map((item) => item.id))
    return state.solutionLibrary.filter((item) => !bound.has(item.id))
  })

  const canManage = () => auth.has("role:manage")

  const resolveError = async (response?: Response) => {
    const current = await code(response)
    if (current !== "account_api_invalid_response") return parseAccountError(response)
    const probe = await request({ path: "/account/admin/roles?page=1&page_size=1" }).catch(() => undefined)
    if (probe?.ok) return "当前后端版本不支持产品管理接口，请重启并升级后端服务后重试"
    return "当前后端不可用，请检查服务器地址并确认服务已启动"
  }

  const load = async () => {
    if (!canManage()) return
    setState("loading", true)
    setState("error", "")
    const response = await request({ path: "/account/admin/products" }).catch(() => undefined)
    setState("loading", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    const body = await response.json().catch(() => undefined)
    if (!Array.isArray(body)) {
      setState("products", [])
      setState("error", "产品列表响应格式不正确，请检查后端服务地址")
      return
    }
    const products = list<ProductItem>(body)
    setState("products", products)
    if (products.length === 0) {
      setState("selectedProductID", "")
      setState("selectedSolutionID", "")
      return
    }
    const product_id = syncProductSelection(products, state.selectedProductID)
    setState("selectedProductID", product_id)
    setState("selectedSolutionID", syncSolutionSelection(products.find((item) => item.id === product_id), state.selectedSolutionID))
  }

  const openCreate = () => {
    setState("createOpen", true)
    setState("formID", "")
    setState("formName", "")
    setState("formDirectory", "")
  }

  const openEdit = (item: ProductItem) => {
    setState("editOpen", true)
    setState("formID", item.id)
    setState("formName", item.name)
    setState("formDirectory", item.worktree ?? "")
  }

  const closeForm = () => {
    if (state.pending) return
    setState("createOpen", false)
    setState("editOpen", false)
    setState("formID", "")
    setState("formName", "")
    setState("formDirectory", "")
  }

  /** 中文注释：切换左侧产品导航时同步刷新解决方案选中项，保持当前产品视角下的绑定列表稳定。 */
  const selectProduct = (item: ProductItem) => {
    if (state.pending) return
    setState("selectedProductID", item.id)
    setState("selectedSolutionID", syncSolutionSelection(item, state.selectedSolutionID))
  }

  /** 中文注释：切换当前产品下的解决方案，右侧详情区同步展示当前绑定方案摘要。 */
  const selectSolution = (item: SolutionItem) => {
    if (state.pending) return
    setState("selectedSolutionID", item.id)
  }

  /** 中文注释：打开可复用解决方案库，供当前产品直接绑定已有方案。 */
  const openSolutionLibrary = async (product: ProductItem) => {
    setState("solutionLibraryOpen", true)
    setState("solutionLibraryLoading", true)
    setState("solutionLibraryProductID", product.id)
    setState("error", "")
    const response = await request({
      path: "/account/admin/solutions",
    }).catch(() => undefined)
    setState("solutionLibraryLoading", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      setState("solutionLibrary", [])
      return
    }
    const body = await response.json().catch(() => undefined)
    setState("solutionLibrary", list<SolutionItem>(body))
  }

  /** 中文注释：关闭方案库弹窗，避免旧的产品上下文残留到下一次绑定操作。 */
  const closeSolutionLibrary = () => {
    if (state.pending || state.solutionLibraryLoading) return
    setState("solutionLibraryOpen", false)
    setState("solutionLibraryProductID", "")
    setState("solutionLibrary", [])
  }

  /** 中文注释：把选中的全局方案绑定到当前产品下，供多个产品复用共享源码目录。 */
  const bindSolution = async (product_id: string, item: SolutionItem) => {
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "POST",
      path: `/account/admin/products/${encodeURIComponent(product_id)}/solution-bindings`,
      body: {
        solution_id: item.id,
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    setState("message", "解决方案已绑定到当前产品")
    closeSolutionLibrary()
    await load()
    setState("selectedSolutionID", item.id)
  }

  /** 中文注释：解绑当前产品下的解决方案，不直接删除全局方案本体。 */
  const removeSolution = async (product_id: string, item: SolutionItem) => {
    if (!globalThis.confirm(`确认将解决方案「${item.name}」从当前产品解绑？`)) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/products/${encodeURIComponent(product_id)}/solutions/${encodeURIComponent(item.id)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    setState("message", "解决方案已从当前产品解绑")
    if (state.selectedSolutionID === item.id) {
      setState("selectedSolutionID", "")
    }
    await load()
  }

  const loadScanDirs = async (target?: string) => {
    setState("scanDirLoading", true)
    const query = new URLSearchParams()
    const value = target?.trim()
    if (value) query.set("path", value)
    const response = await request({
      path: query.size > 0 ? `/account/admin/fs/directories?${query.toString()}` : "/account/admin/fs/directories",
    }).catch(() => undefined)
    setState("scanDirLoading", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    const body = (await response.json().catch(() => undefined)) as
      | {
          ok?: boolean
          current?: string
          parent?: string
          directories?: ScanDirEntry[]
        }
      | undefined
    setState("scanDirCurrent", body?.current ?? "")
    setState("scanDirParent", body?.parent ?? "")
    setState("scanDirEntries", list<ScanDirEntry>(body?.directories))
  }

  const openDirectory = async (target: "create" | "edit") => {
    setState("scanTarget", target)
    setState("scanDirOpen", true)
    setState("error", "")
    await loadScanDirs(state.formDirectory)
  }

  const closeDirectory = () => {
    if (state.scanDirLoading || state.pending) return
    setState("scanDirOpen", false)
    setState("scanDirCurrent", "")
    setState("scanDirParent", "")
    setState("scanDirEntries", [])
  }

  const enterDirectory = async (target: string) => {
    await loadScanDirs(target)
  }

  const enterParent = async () => {
    const parent = state.scanDirParent.trim()
    if (!parent) {
      await loadScanDirs(undefined)
      return
    }
    await loadScanDirs(parent)
  }

  const confirmDirectory = () => {
    const current = state.scanDirCurrent.trim()
    if (!current) return
    setState("formDirectory", current)
    closeDirectory()
  }

  const createProduct = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.formName.trim()) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "POST",
      path: "/account/admin/products",
      body: {
        name: state.formName.trim(),
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    const body = obj(await response.json().catch(() => undefined))
    if (body?.ok !== true) {
      setState("error", "创建产品失败，请检查后端服务地址")
      return
    }
    setState("message", "产品已创建")
    closeForm()
    await load()
  }

  const saveProduct = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.formID || !state.formName.trim()) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "PATCH",
      path: `/account/admin/products/${encodeURIComponent(state.formID)}`,
      body: {
        name: state.formName.trim(),
        directory: state.formDirectory.trim(),
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    const body = obj(await response.json().catch(() => undefined))
    if (body?.ok !== true) {
      setState("error", "更新产品失败，请检查后端服务地址")
      return
    }
    setState("message", "产品已更新")
    closeForm()
    await load()
  }

  const removeProduct = async (item: ProductItem) => {
    if (!globalThis.confirm(`确认删除产品「${item.name}」？`)) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/products/${encodeURIComponent(item.id)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await resolveError(response))
      return
    }
    setState("message", "产品已删除")
    await load()
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  createEffect(() => {
    const product_id = syncProductSelection(visibleProducts(), state.selectedProductID)
    if (product_id !== state.selectedProductID) {
      setState("selectedProductID", product_id)
      return
    }
    const solution_id = syncSolutionSelection(currentProduct(), state.selectedSolutionID)
    if (solution_id !== state.selectedSolutionID) {
      setState("selectedSolutionID", solution_id)
    }
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canManage()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有产品管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-18-medium text-text-strong">产品管理</div>
              <div class="text-12-regular text-text-weak mt-1">左侧选择产品，右侧只维护产品与解决方案的绑定关系；方案详情统一到“解决方案库”里维护。</div>
            </div>
            <div class="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
                刷新
              </Button>
              <Button type="button" onClick={openCreate} disabled={state.pending}>
                新增产品
              </Button>
            </div>
          </div>

          <Show when={state.message}>
            <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
          </Show>
          <Show when={state.error}>
            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
          </Show>

          <div class={projectsLayoutClass()}>
            <aside class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
              <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong flex items-center justify-between">
                <span>产品导航</span>
                <Show when={state.loading}>
                  <span class="text-12-regular text-text-weak">加载中...</span>
                </Show>
              </div>
              <div class="border-b border-border-weak-base px-3 py-3">
                <input
                  class="h-10 w-full rounded-md border border-border-weak-base bg-surface-panel/45 px-3 text-13-regular text-text-strong"
                  placeholder="检索产品名称"
                  value={state.productSearch}
                  onInput={(event) => setState("productSearch", event.currentTarget.value)}
                />
              </div>
              <div class="max-h-[720px] overflow-auto p-3 flex flex-col gap-2">
                <For each={visibleProducts()}>
                  {(item) => (
                    <button
                      type="button"
                      class={`w-full rounded-xl border p-4 text-left transition-all ${productItemClass(state.selectedProductID === item.id)}`}
                      onClick={() => selectProduct(item)}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong break-all">{item.name}</div>
                          <div class="mt-1 text-11-regular text-text-weak line-clamp-2 break-all">{item.worktree}</div>
                        </div>
                        <div class="shrink-0 rounded-full bg-surface-panel px-2 py-1 text-11-medium text-text-weak">
                          {item.solutions?.length ?? 0} 个方案
                        </div>
                      </div>
                      <div class="mt-3 flex items-center justify-between gap-2 text-11-regular text-text-weak">
                        <span>更新时间</span>
                        <span>{timeText(item.time_updated)}</span>
                      </div>
                    </button>
                  )}
                </For>
                <Show when={state.products.length === 0}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                    暂无产品数据
                  </div>
                </Show>
                <Show when={state.products.length > 0 && visibleProducts().length === 0}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                    没有匹配的产品
                  </div>
                </Show>
              </div>
            </aside>

            <div class="min-w-0 flex flex-col gap-4">
              <section class="rounded-xl border border-border-weak-base bg-surface-base p-5">
                <Show when={currentProduct()} fallback={<div class="text-12-regular text-text-weak">请选择左侧产品后查看详情。</div>}>
                  <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div class="min-w-0">
                        <div class="text-18-medium text-text-strong break-all">{currentProduct()?.name}</div>
                        <div class="mt-1 text-12-regular text-text-weak">
                          产品本身作为虚拟组合入口，当前目录主要用于项目上下文与默认入口兼容。
                        </div>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => currentProduct() && openEdit(currentProduct()!)} disabled={!currentProduct() || state.pending}>
                          编辑产品
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => currentProduct() && void openSolutionLibrary(currentProduct()!)} disabled={!currentProduct() || state.pending}>
                          绑定已有方案
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => props.onOpenSolutionLibrary?.()} disabled={state.pending}>
                          前往方案库
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => currentProduct() && void removeProduct(currentProduct()!)} disabled={!currentProduct() || state.pending}>
                          删除产品
                        </Button>
                      </div>
                    </div>
                    <div class="grid gap-3 md:grid-cols-3">
                      <div class="rounded-xl bg-surface-panel/45 p-3">
                        <div class="text-11-medium text-text-weak">绑定目录</div>
                        <div class="mt-2 text-12-regular text-text-strong break-all">{currentProduct()?.worktree || "-"}</div>
                      </div>
                      <div class="rounded-xl bg-surface-panel/45 p-3">
                        <div class="text-11-medium text-text-weak">默认项目 ID</div>
                        <div class="mt-2 text-12-regular text-text-strong break-all">{currentProduct()?.project_id || "-"}</div>
                      </div>
                      <div class="rounded-xl bg-surface-panel/45 p-3">
                        <div class="text-11-medium text-text-weak">解决方案数量</div>
                        <div class="mt-2 text-12-regular text-text-strong">{currentProduct()?.solutions?.length ?? 0}</div>
                      </div>
                    </div>
                  </div>
                </Show>
              </section>

              <section class={projectsSolutionLayoutClass()}>
                <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
                  <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong">解决方案列表</div>
                  <div class="max-h-[620px] overflow-auto p-3 flex flex-col gap-2">
                    <Show when={currentProduct()} fallback={<div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">请选择产品后查看解决方案</div>}>
                      <For each={currentProduct()?.solutions ?? []}>
                        {(item) => (
                          <button
                            type="button"
                            class={`w-full rounded-xl border p-3 text-left transition-all ${solutionItemClass(state.selectedSolutionID === item.id)}`}
                            onClick={() => selectSolution(item)}
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="text-13-medium break-all">{item.name}</div>
                                <div class="mt-1 text-11-regular break-all">{item.code}</div>
                              </div>
                              <div class="shrink-0 rounded-full px-2 py-1 text-11-medium" classList={{ "bg-icon-success-base/10 text-icon-success-base": item.enabled, "bg-icon-critical-base/10 text-icon-critical-base": !item.enabled }}>
                                {item.enabled ? "启用" : "停用"}
                              </div>
                            </div>
                            <div class="mt-3 text-11-regular text-text-weak">目录数：{item.roots.length} · 更新于 {timeText(item.time_updated)}</div>
                          </button>
                        )}
                      </For>
                      <Show when={(currentProduct()?.solutions ?? []).length === 0}>
                        <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-8 text-center text-12-regular text-text-weak">
                          当前产品还没有绑定解决方案，请先从方案库中绑定。
                        </div>
                      </Show>
                    </Show>
                  </div>
                </div>

                <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
                  <div class="px-4 py-3 border-b border-border-weak-base flex items-center justify-between gap-3">
                    <div>
                      <div class="text-13-medium text-text-strong">绑定方案详情</div>
                      <div class="mt-1 text-11-regular text-text-weak">当前页面只做绑定关系管理；方案配置请前往“解决方案库”统一维护。</div>
                    </div>
                    <Show when={currentSolution()}>
                      <div class="flex gap-2">
                        <Button type="button" size="small" variant="secondary" onClick={() => props.onOpenSolutionLibrary?.()} disabled={state.pending}>
                          去方案库编辑
                        </Button>
                        <Button type="button" size="small" variant="secondary" onClick={() => currentProduct() && currentSolution() && void removeSolution(currentProduct()!.id, currentSolution()!)} disabled={state.pending}>
                          解绑
                        </Button>
                      </div>
                    </Show>
                  </div>
                  <div class="p-4">
                    <Show
                      when={currentSolution()}
                      fallback={
                        <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-10 text-center text-12-regular text-text-weak">请选择一个解决方案，或者先到“解决方案库”新增后再绑定。</div>
                      }
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
                            <div class="text-11-medium text-text-weak">默认项目 ID</div>
                            <div class="mt-2 text-12-regular text-text-strong break-all">{currentSolution()?.primary_project_id || currentProduct()?.project_id || "-"}</div>
                          </div>
                          <div class="rounded-xl bg-surface-panel/45 p-3">
                            <div class="text-11-medium text-text-weak">状态</div>
                            <div class="mt-2 text-12-regular text-text-strong">{currentSolution()?.enabled ? "启用" : "停用"}</div>
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
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </Show>

      <Show when={state.createOpen || state.editOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={state.createOpen ? createProduct : saveProduct}>
            <div class="text-16-medium text-text-strong">{state.createOpen ? "新增产品" : "编辑产品"}</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="请输入产品名称"
              value={state.formName}
              onInput={(event) => setState("formName", event.currentTarget.value)}
            />
            <Show when={state.editOpen}>
              <div class="flex flex-col gap-3">
                <div class="flex gap-2">
                  <input
                    class="h-10 flex-1 min-w-0 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                    placeholder="请选择绑定目录"
                    value={state.formDirectory}
                    readOnly
                  />
                  <Button type="button" variant="secondary" onClick={() => void openDirectory("edit")} disabled={state.pending}>
                    选择目录
                  </Button>
                </div>
                <div class="text-11-regular text-text-weak">绑定目录仅作为兼容上下文项目入口使用；新产品可以不配置。</div>
              </div>
            </Show>
            <Show when={state.createOpen}>
              <div class="rounded-xl bg-surface-panel/45 px-3 py-2 text-11-regular text-text-weak">
                新增产品时不再要求绑定目录，后续可直接通过解决方案配置源码路径。
              </div>
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeForm} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending || !state.formName.trim()}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.solutionLibraryOpen}>
        <div class="fixed inset-0 z-[145] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <div class="w-full max-w-4xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-16-medium text-text-strong">绑定已有解决方案</div>
                <div class="mt-1 text-12-regular text-text-weak">从全局方案库中选择一个方案，绑定到当前产品下复用。</div>
              </div>
              <Button type="button" variant="secondary" onClick={closeSolutionLibrary} disabled={state.pending || state.solutionLibraryLoading}>
                关闭
              </Button>
            </div>
            <div class="max-h-[520px] overflow-auto rounded-md border border-border-weak-base bg-surface-base p-3 flex flex-col gap-2">
              <Show when={!state.solutionLibraryLoading} fallback={<div class="px-2 py-6 text-12-regular text-text-weak">加载方案库中...</div>}>
                <For each={bindableSolutions()}>
                  {(item) => (
                    <div class="rounded-xl border border-border-weak-base bg-surface-panel/35 p-3 flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-13-medium text-text-strong break-all">{item.name}</div>
                        <div class="mt-1 text-11-regular text-text-weak break-all">{item.code}</div>
                        <div class="mt-2 text-11-regular text-text-weak">
                          roots：{item.roots.length} · 默认项目：{item.primary_project_id || "-"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="small"
                        onClick={() => void bindSolution(state.solutionLibraryProductID, item)}
                        disabled={state.pending || !state.solutionLibraryProductID}
                      >
                        绑定
                      </Button>
                    </div>
                  )}
                </For>
                <Show when={bindableSolutions().length === 0}>
                  <div class="px-2 py-6 text-12-regular text-text-weak">当前没有可绑定的现有方案，或者该产品已绑定全部方案。</div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={state.scanDirOpen}>
        <div class="fixed inset-0 z-[150] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <div class="w-full max-w-3xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3">
            <div class="text-16-medium text-text-strong">选择绑定目录</div>
            <div class="flex items-center gap-2">
              <Button type="button" size="small" variant="secondary" disabled={state.scanDirLoading} onClick={() => void loadScanDirs(undefined)}>
                根目录
              </Button>
              <Button type="button" size="small" variant="secondary" disabled={state.scanDirLoading} onClick={() => void enterParent()}>
                上一级
              </Button>
              <div class="min-w-0 text-12-regular text-text-weak break-all">
                {state.scanDirCurrent || "请选择目录根节点"}
              </div>
            </div>
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.scanDirLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载目录中...</div>}>
                <For each={state.scanDirEntries}>
                  {(item) => (
                    <button
                      type="button"
                      class="w-full text-left rounded px-2 py-1.5 hover:bg-surface-panel/50"
                      onClick={() => void enterDirectory(item.path)}
                    >
                      <div class="text-12-medium text-text-strong">{item.name}</div>
                      <div class="text-11-regular text-text-weak break-all">{item.path}</div>
                    </button>
                  )}
                </For>
                <Show when={state.scanDirEntries.length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">当前目录没有子目录</div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeDirectory} disabled={state.scanDirLoading || state.pending}>
                取消
              </Button>
              <Button type="button" disabled={!state.scanDirCurrent || state.scanDirLoading || state.pending} onClick={confirmDirectory}>
                选择当前目录
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
