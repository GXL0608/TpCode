import { Button } from "@opencode-ai/ui/button"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { nextOpenProjectIDs } from "@/context/account-project"

type Row = {
  id: string
  name?: string
  project_id: string
  worktree: string
  selected: boolean
  last_selected: boolean
}

export default function AccountProjectSelect() {
  const auth = useAccountAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = createSignal(true)
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [rows, setRows] = createSignal<Row[]>([])
  const [current, setCurrent] = createSignal("")

  const chosen = createMemo(() => {
    if (current()) return current()
    const found = rows().find((item) => item.last_selected) ?? rows()[0]
    return found?.id ?? ""
  })

  const load = async () => {
    setLoading(true)
    setError("")
    const payload = await auth.contextProducts()
    if (!payload) {
      setRows([])
      setLoading(false)
      const reason = auth.lastError()
      if (reason === "account_api_invalid_response") {
        setError("当前后端不支持产品接口（可能服务地址错误，或后端版本过旧）")
        return
      }
      setError("加载产品失败")
      return
    }
    const list = payload.products ?? []
    setRows(list)
    const preferred = payload.last_project_id && list.some((item) => item.project_id === payload.last_project_id)
    const selected = preferred
      ? (list.find((item) => item.project_id === payload.last_project_id)?.id ?? "")
      : (list.find((item) => item.last_selected)?.id ?? list[0]?.id ?? "")
    setCurrent(selected)
    setLoading(false)
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.enabled()) {
      navigate("/")
      return
    }
    if (!auth.authenticated()) return
    void load()
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const product_id = chosen()
    if (!product_id) return
    const target = rows().find((item) => item.id === product_id)
    if (!target) {
      setError("所选产品不存在，请重新选择")
      return
    }
    setPending(true)
    setError("")
    const result = await auth.selectContext(target.project_id)
    if (!result.ok) {
      setPending(false)
      setError("找不到文件夹，请联系管理员检查项目路径")
      return
    }
    void auth.contextState().then((current) => {
      const open_project_ids = nextOpenProjectIDs({
        open_project_ids: current?.open_project_ids ?? [],
        project_id: target.project_id,
      })
      void auth.updateContextState({
        last_project_id: target.project_id,
        open_project_ids,
      })
    })
    const href = `/${base64Encode(target.worktree)}/session`
    navigate(href, { replace: true })
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-2xl flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">选择产品</div>
        <div class="text-12-regular text-text-weak">请先选择你当前要进入的产品。系统会记住你的上次选择。</div>
        <Show when={loading()}>
          <div class="text-12-regular text-text-weak">加载中...</div>
        </Show>
        <Show when={!loading() && rows().length === 0}>
          <div class="text-12-regular text-icon-critical-base">当前账号未分配任何产品，请联系管理员。</div>
        </Show>
        <Show when={!loading() && rows().length > 0}>
          <div class="flex flex-col gap-2 max-h-96 overflow-auto pr-1">
            <For each={rows()}>
              {(item) => (
                <button
                  type="button"
                  class="w-full rounded-md px-3 py-2 text-left transition-colors"
                  classList={{
                    "border-2 border-icon-strong-base bg-surface-base-hover": chosen() === item.id,
                    "border border-border-weak-base bg-surface-base hover:bg-surface-base-hover": chosen() !== item.id,
                  }}
                  aria-pressed={chosen() === item.id}
                  onClick={() => setCurrent(item.id)}
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-14-medium text-text-strong">{item.name || item.project_id}</div>
                    <Show when={chosen() === item.id}>
                      <div class="rounded-full bg-icon-success-base/10 px-2 py-0.5 text-11-medium text-icon-success-base">
                        当前选择
                      </div>
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={error()}>
          <div class="text-12-regular text-icon-critical-base">{error()}</div>
        </Show>
        <div class="flex items-center gap-2">
          <Button type="submit" disabled={pending() || !chosen()}>
            {pending() ? "进入中..." : "进入产品"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending()} onClick={() => auth.logout()}>
            退出登录
          </Button>
        </div>
      </form>
    </div>
  )
}
