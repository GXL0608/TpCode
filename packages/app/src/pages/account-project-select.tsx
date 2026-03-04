import { Button } from "@opencode-ai/ui/button"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"

type Row = {
  id: string
  name?: string
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
    const payload = await auth.contextProjects()
    if (!payload) {
      setRows([])
      setLoading(false)
      setError("加载项目失败")
      return
    }
    const list = payload.projects ?? []
    setRows(list)
    const preferred = payload.last_project_id && list.some((item) => item.id === payload.last_project_id)
    const selected = preferred ? payload.last_project_id! : (list.find((item) => item.last_selected)?.id ?? list[0]?.id ?? "")
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
    if (auth.user()?.context_project_id) {
      navigate("/")
      return
    }
    void load()
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const project_id = chosen()
    if (!project_id) return
    const target = rows().find((item) => item.id === project_id)
    if (!target) {
      setError("所选项目不存在，请重新选择")
      return
    }
    setPending(true)
    setError("")
    const result = await auth.selectContext(project_id)
    if (!result.ok) {
      setPending(false)
      setError("找不到文件夹，请联系管理员检查项目路径")
      return
    }
    setPending(false)
    const href = `/${base64Encode(target.worktree)}/session`
    setTimeout(() => navigate(href, { replace: true }))
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-2xl flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">选择项目</div>
        <div class="text-12-regular text-text-weak">请先选择你当前要进入的项目。系统会记住你的上次选择。</div>
        <Show when={loading()}>
          <div class="text-12-regular text-text-weak">加载中...</div>
        </Show>
        <Show when={!loading() && rows().length === 0}>
          <div class="text-12-regular text-icon-critical-base">当前账号未分配任何项目，请联系管理员。</div>
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
                    <div class="text-14-medium text-text-strong">{item.name || item.worktree}</div>
                    <Show when={chosen() === item.id}>
                      <div class="rounded-full bg-icon-success-base/10 px-2 py-0.5 text-11-medium text-icon-success-base">
                        当前选择
                      </div>
                    </Show>
                  </div>
                  <div class="text-12-regular text-text-weak mt-1 break-all">{item.worktree}</div>
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
            {pending() ? "进入中..." : "进入项目"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending()} onClick={() => auth.logout()}>
            退出登录
          </Button>
        </div>
      </form>
    </div>
  )
}
