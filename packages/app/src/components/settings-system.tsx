import { Button } from "@opencode-ai/ui/button"
import { Show, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"

export const SettingsSystem = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()

  const [state, setState] = createStore({
    loading: false,
    saving: false,
    error: "",
    message: "",
    scanRoot: "",
    source: "default" as "env" | "setting" | "default",
  })

  const load = async () => {
    if (!auth.has("role:manage")) return
    setState("loading", true)
    setState("error", "")
    const response = await request({ path: "/account/admin/settings/project-scan-root" }).catch(() => undefined)
    setState("loading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const body = (await response.json().catch(() => undefined)) as
      | { project_scan_root?: string; source?: "env" | "setting" | "default" }
      | undefined
    setState("scanRoot", body?.project_scan_root ?? "")
    setState("source", body?.source ?? "default")
  }

  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    setState("saving", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "PUT",
      path: "/account/admin/settings/project-scan-root",
      body: {
        project_scan_root: state.scanRoot.trim() || undefined,
      },
    }).catch(() => undefined)
    setState("saving", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "扫描根目录已保存")
    await load()
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-18-medium text-text-strong">系统设置</div>
            <div class="text-12-regular text-text-weak mt-1">控制项目管理中的目录扫描根路径</div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
            刷新
          </Button>
        </div>

        <Show when={state.message}>
          <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
        </Show>
        <Show when={state.error}>
          <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
        </Show>

        <form class="rounded-xl border border-border-weak-base bg-surface-base p-4 flex flex-col gap-3" onSubmit={save}>
          <div class="flex items-center justify-between">
            <div class="text-13-medium text-text-strong">TPCODE_PROJECT_SCAN_ROOT</div>
            <div class="text-11-regular text-text-weak">来源：{state.source}</div>
          </div>
          <input
            class="h-10 rounded-md border border-border-weak-base bg-background-base px-3 text-14-regular"
            placeholder="可填多个目录，逗号分隔；留空使用默认路径"
            value={state.scanRoot}
            onInput={(event) => setState("scanRoot", event.currentTarget.value)}
          />
          <div class="text-11-regular text-text-weak">
            项目管理会扫描这些根目录下的一级子目录；包含 `.git` 的目录会优先识别为项目并进入可分配列表。
          </div>
          <div class="flex justify-end">
            <Button type="submit" disabled={state.saving}>
              {state.saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
