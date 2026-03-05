import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"

type ProductItem = {
  id: string
  name: string
  project_id: string
  worktree: string
  vcs?: string
  time_created: number
  time_updated: number
}

type ScanDirEntry = {
  path: string
  name: string
}

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function obj(input: unknown) {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

async function code(response?: Response) {
  const payload = obj(await response?.clone().json().catch(() => undefined))
  const code = payload?.code
  if (typeof code === "string") return code
  const error = payload?.error
  if (typeof error === "string") return error
  return ""
}

function timeText(input: number) {
  if (!input) return "-"
  return new Date(input).toLocaleString()
}

export const SettingsProjects = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    products: [] as ProductItem[],
    createOpen: false,
    editOpen: false,
    formID: "",
    formName: "",
    formDirectory: "",
    scanTarget: "create" as "create" | "edit",
    scanDirOpen: false,
    scanDirLoading: false,
    scanDirCurrent: "",
    scanDirParent: "",
    scanDirEntries: [] as ScanDirEntry[],
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
    setState("products", list<ProductItem>(body))
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
    setState("formDirectory", item.worktree)
  }

  const closeForm = () => {
    if (state.pending) return
    setState("createOpen", false)
    setState("editOpen", false)
    setState("formID", "")
    setState("formName", "")
    setState("formDirectory", "")
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
    if (!state.formName.trim() || !state.formDirectory.trim()) return
    setState("pending", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "POST",
      path: "/account/admin/products",
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
      setState("error", "创建产品失败，请检查后端服务地址")
      return
    }
    setState("message", "产品已创建")
    closeForm()
    await load()
  }

  const saveProduct = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.formID || !state.formName.trim() || !state.formDirectory.trim()) return
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

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canManage()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有项目管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-18-medium text-text-strong">项目管理</div>
              <div class="text-12-regular text-text-weak mt-1">维护产品与目录绑定关系，供角色分配产品使用</div>
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

          <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong flex items-center justify-between">
              <span>产品列表</span>
              <Show when={state.loading}>
                <span class="text-12-regular text-text-weak">加载中...</span>
              </Show>
            </div>
            <div class="max-h-[560px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">产品名称</th>
                    <th class="text-left px-3 py-2">绑定目录</th>
                    <th class="text-left px-3 py-2">更新时间</th>
                    <th class="text-left px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.products}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base hover:bg-surface-panel/45 transition-colors">
                        <td class="px-3 py-2">{item.name}</td>
                        <td class="px-3 py-2 break-all">{item.worktree}</td>
                        <td class="px-3 py-2">{timeText(item.time_updated)}</td>
                        <td class="px-3 py-2">
                          <div class="flex gap-1.5">
                            <Button type="button" size="small" variant="secondary" onClick={() => openEdit(item)} disabled={state.pending}>
                              编辑
                            </Button>
                            <Button type="button" size="small" variant="secondary" onClick={() => void removeProduct(item)} disabled={state.pending}>
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.products.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={4}>
                        暂无产品数据
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
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
            <div class="flex gap-2">
              <input
                class="h-10 flex-1 min-w-0 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                placeholder="请选择绑定目录"
                value={state.formDirectory}
                readOnly
              />
              <Button type="button" variant="secondary" onClick={() => void openDirectory(state.createOpen ? "create" : "edit")} disabled={state.pending}>
                选择目录
              </Button>
            </div>
            <div class="text-11-regular text-text-weak">目录可任意选择，保存时会自动校验目录可访问，并生成或关联对应项目。</div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeForm} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending || !state.formName.trim() || !state.formDirectory.trim()}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
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
