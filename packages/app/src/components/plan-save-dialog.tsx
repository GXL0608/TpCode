import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { createStore } from "solid-js/store"
import { For, Show, onMount, type Component } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useAccountAuth } from "@/context/account-auth"
import { useLanguage } from "@/context/language"

type PlanSaveFeedbackQuery = {
  user_id: string
  page_num: number
  page_size: number
  resolution_status: Array<"0" | "9">
}

type Props = {
  phone: string
  onConfirm: (vho_feedback_no?: string) => void
  onCancel: () => void
}

/** 中文注释：为保存计划弹窗生成默认的 VHO 反馈查询条件，默认只拉当前手机号最近的待处理/未关闭项。 */
export function buildPlanSaveFeedbackQuery(phone: string): PlanSaveFeedbackQuery {
  return {
    user_id: phone.trim(),
    page_num: 1,
    page_size: 20,
    resolution_status: ["0", "9"],
  }
}

/** 中文注释：统一处理手填与列表选择的反馈号，优先采用用户手动输入。 */
export function resolvePlanSaveFeedbackNo(input: { manual?: string; selected?: string }) {
  const manual = input.manual?.trim()
  if (manual) return manual
  const selected = input.selected?.trim()
  if (selected) return selected
}

/** 中文注释：在保存计划前提供一个轻量弹窗，让用户可选填写或选择 VHO 反馈号。 */
export const DialogPlanSave: Component<Props> = (props) => {
  const auth = useAccountAuth()
  const language = useLanguage()
  const dialog = useDialog()
  const inputClass =
    "rounded-md border border-border-weak-base bg-background px-3 py-2 text-13-regular placeholder:text-text-weak"
  const [store, setStore] = createStore({
    loading: false,
    error: "",
    manual: "",
    selected: "",
    items: [] as Array<{
      feedback_id: string
      feedback_des?: string
      customer_name?: string
      feedback_time?: string
      resolution_status_name?: string
    }>,
  })

  /** 中文注释：按当前手机号读取最近反馈列表，供保存计划时快速选中已有反馈单。 */
  const load = async () => {
    setStore("loading", true)
    setStore("error", "")
    const result = await auth.listVhoFeedback(buildPlanSaveFeedbackQuery(props.phone))
    setStore("loading", false)
    if (!result.ok) {
      setStore("error", result.message ?? result.code)
      return
    }
    setStore(
      "items",
      result.list.map((item) => ({
        feedback_id: item.feedback_id,
        feedback_des: typeof item.feedback_des === "string" ? item.feedback_des : undefined,
        customer_name: typeof item.customer_name === "string" ? item.customer_name : undefined,
        feedback_time: typeof item.feedback_time === "string" ? item.feedback_time : undefined,
        resolution_status_name: typeof item.resolution_status_name === "string" ? item.resolution_status_name : undefined,
      })),
    )
  }

  onMount(() => {
    void load()
  })

  /** 中文注释：确认当前输入，并把可选反馈号返回给保存计划主流程。 */
  const confirm = () => {
    props.onConfirm(
      resolvePlanSaveFeedbackNo({
        manual: store.manual,
        selected: store.selected,
      }),
    )
    dialog.close()
  }

  return (
    <Dialog title="保存计划" description={`当前保存账号手机号：${props.phone}`}>
      <div class="flex flex-col gap-4 px-4 pb-4">
        <div class="grid gap-2">
          <div class="text-12-medium text-text-strong">可选关联 VHO 反馈号</div>
          <input
            class={inputClass}
            value={store.manual}
            placeholder="可直接填写 VHO 反馈号，也可以从下面列表选择"
            autofocus
            onInput={(event) => setStore("manual", event.currentTarget.value)}
          />
          <div class="text-11-regular text-text-weak">留空表示只保存计划，不在本次保存时写入反馈号。</div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-12-medium text-text-strong">最近反馈</div>
          <Button type="button" variant="secondary" size="small" loading={store.loading} onClick={() => void load()}>
            刷新列表
          </Button>
        </div>

        <Show when={store.error}>
          <div class="rounded-lg bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">
            {store.error}
          </div>
        </Show>

        <div class="max-h-[320px] overflow-y-auto rounded-lg border border-border-weak-base">
          <Show
            when={store.items.length > 0}
            fallback={<div class="px-3 py-6 text-center text-12-regular text-text-weak">{store.loading ? "正在加载反馈列表..." : "暂无可选反馈，可直接手工填写反馈号。"}</div>}
          >
            <div class="divide-y divide-border-weak-base">
              <For each={store.items}>
                {(item) => (
                  <button
                    type="button"
                    class="w-full px-3 py-3 text-left transition-colors hover:bg-surface-panel/45"
                    classList={{
                      "bg-brand-solid/10": store.selected === item.feedback_id,
                    }}
                    onClick={() => {
                      setStore("selected", item.feedback_id)
                      if (!store.manual.trim()) setStore("manual", item.feedback_id)
                    }}
                  >
                    <div class="text-12-medium text-text-strong">{item.feedback_id}</div>
                    <Show when={item.feedback_des}>
                      <div class="mt-1 text-12-regular text-text-weak whitespace-pre-wrap break-all">{item.feedback_des}</div>
                    </Show>
                    <div class="mt-1 text-11-regular text-text-weak">
                      {[item.customer_name, item.feedback_time, item.resolution_status_name].filter(Boolean).join(" · ") || "-"}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={confirm}>
            保存计划
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
