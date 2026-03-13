import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, For, Match, Show, Switch, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { useLanguage } from "@/context/language"

type Props = {
  onSelect: (input: { prompt_text: string; feedback_des: string; plan_content: string }) => void
}

/**
 * 中文注释：在 build 模式下检索 VHO 反馈并把选中结果回填到会话输入框。
 */
export const DialogVhoFeedback: Component<Props> = (props) => {
  const auth = useAccountAuth()
  const language = useLanguage()
  const dialog = useDialog()
  const [advanced, setAdvanced] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [resolving, setResolving] = createSignal("")
  const [store, setStore] = createStore({
    feedback_id: "",
    plan_id: "",
    feedback_des: "",
    resolution_status: "",
    plan_start_date: "",
    plan_end_date: "",
    page_num: 1,
    page_size: 10,
    total: 0,
    list: [] as Array<{
      feedback_id: string
      plan_id?: string
      feedback_des?: string
      customer_name?: string
      feedback_time?: string
      resolution_status_name?: string
    }>,
    error: "",
  })

  const inputClass =
    "rounded-md border border-border-weak-base bg-background px-3 py-2 text-13-regular placeholder:text-text-weak"

  /**
   * 中文注释：统一执行列表查询，并在失败时把错误留在弹窗内。
   */
  const search = async (page_num = store.page_num) => {
    setLoading(true)
    setStore("error", "")
    const result = await auth.listVhoFeedback({
      feedback_id: store.feedback_id,
      plan_id: store.plan_id,
      feedback_des: store.feedback_des,
      resolution_status: store.resolution_status,
      plan_start_date: store.plan_start_date,
      plan_end_date: store.plan_end_date,
      page_num,
      page_size: store.page_size,
    })
    setLoading(false)
    if (!result.ok) {
      setStore("error", result.message ?? result.code)
      return
    }
    setStore({
      list: result.list,
      total: result.total,
      page_num: result.page_num,
      page_size: result.page_size,
    })
  }

  /**
   * 中文注释：选中反馈后解析本地计划并向上层回传 prompt 文本。
   */
  const select = async (item: { feedback_id: string; plan_id?: string; feedback_des?: string }) => {
    if (resolving()) return
    setResolving(item.feedback_id)
    setStore("error", "")
    const result = await auth.resolveVhoFeedback({
      feedback_id: item.feedback_id,
      plan_id: item.plan_id,
      feedback_des: item.feedback_des,
    })
    setResolving("")
    if (!result.ok) {
      setStore("error", result.message ?? result.code)
      return
    }
    props.onSelect(result)
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("dialog.vhoFeedback.select.success"),
    })
  }

  const totalPages = () => Math.max(1, Math.ceil(store.total / Math.max(store.page_size, 1)))

  return (
    <Dialog
      title={language.t("dialog.vhoFeedback.title")}
      description={language.t("dialog.vhoFeedback.description")}
      size="xx-large"
    >
      <div class="flex min-h-0 flex-col gap-4 px-4 pb-4">
        <div class="grid gap-3 md:grid-cols-3">
          <input
            class={inputClass}
            value={store.feedback_id}
            placeholder={language.t("dialog.vhoFeedback.feedbackId")}
            onInput={(event) => setStore("feedback_id", event.currentTarget.value)}
          />
          <input
            class={inputClass}
            value={store.plan_id}
            placeholder={language.t("dialog.vhoFeedback.planId")}
            onInput={(event) => setStore("plan_id", event.currentTarget.value)}
          />
          <input
            class={inputClass}
            value={store.feedback_des}
            placeholder={language.t("dialog.vhoFeedback.feedbackDes")}
            onInput={(event) => setStore("feedback_des", event.currentTarget.value)}
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="small" onClick={() => setAdvanced((value) => !value)}>
            {advanced()
              ? language.t("dialog.vhoFeedback.advanced.hide")
              : language.t("dialog.vhoFeedback.advanced.show")}
          </Button>
          <Button type="button" size="small" onClick={() => void search(1)} disabled={loading()}>
            {loading() ? language.t("dialog.vhoFeedback.searching") : language.t("dialog.vhoFeedback.search")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() =>
              setStore({
                feedback_id: "",
                plan_id: "",
                feedback_des: "",
                resolution_status: "",
                plan_start_date: "",
                plan_end_date: "",
                page_num: 1,
                page_size: 10,
                total: 0,
                list: [],
                error: "",
              })
            }
          >
            {language.t("dialog.vhoFeedback.reset")}
          </Button>
        </div>

        <Show when={advanced()}>
          <div class="grid gap-3 rounded-lg border border-border-weak-base bg-surface-panel p-3 md:grid-cols-4">
            <input
              class={inputClass}
              value={store.resolution_status}
              placeholder={language.t("dialog.vhoFeedback.resolutionStatus")}
              onInput={(event) => setStore("resolution_status", event.currentTarget.value)}
            />
            <input
              class={inputClass}
              value={store.plan_start_date}
              type="date"
              onInput={(event) => setStore("plan_start_date", event.currentTarget.value)}
            />
            <input
              class={inputClass}
              value={store.plan_end_date}
              type="date"
              onInput={(event) => setStore("plan_end_date", event.currentTarget.value)}
            />
            <input
              class={inputClass}
              value={String(store.page_size)}
              type="number"
              min="1"
              onInput={(event) => setStore("page_size", Math.max(1, Number(event.currentTarget.value || 10)))}
            />
          </div>
        </Show>

        <Show when={store.error}>
          {(value) => (
            <div class="rounded-md bg-danger-base/10 px-3 py-2 text-12-regular text-danger-base">{value()}</div>
          )}
        </Show>

        <div class="min-h-[320px] rounded-lg border border-border-weak-base">
          <Show
            when={store.list.length > 0}
            fallback={
              <div class="flex min-h-[320px] items-center justify-center px-4 text-12-regular text-text-weak">
                {loading() ? language.t("dialog.vhoFeedback.searching") : language.t("dialog.vhoFeedback.empty")}
              </div>
            }
          >
            <div class="grid divide-y divide-border-weak-base">
              <For each={store.list}>
                {(item) => (
                  <div class="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-start">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2 text-13-medium text-text-strong">
                        <span>{item.feedback_id}</span>
                        <Show when={item.plan_id}>
                          <span class="rounded-full bg-surface-panel px-2 py-0.5 text-11-regular text-text-weak">
                            {language.t("dialog.vhoFeedback.planIdLabel")}: {item.plan_id}
                          </span>
                        </Show>
                      </div>
                      <div class="mt-2 whitespace-pre-wrap break-words text-12-regular text-text-strong">
                        {item.feedback_des || "-"}
                      </div>
                      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weak">
                        <span>
                          {language.t("dialog.vhoFeedback.customer")}: {item.customer_name || "-"}
                        </span>
                        <span>
                          {language.t("dialog.vhoFeedback.feedbackTime")}: {item.feedback_time || "-"}
                        </span>
                        <span>
                          {language.t("dialog.vhoFeedback.status")}: {item.resolution_status_name || "-"}
                        </span>
                      </div>
                    </div>
                    <div class="flex justify-end">
                      <Button
                        type="button"
                        size="small"
                        onClick={() => void select(item)}
                        disabled={resolving() === item.feedback_id}
                      >
                        <Switch>
                          <Match when={resolving() === item.feedback_id}>
                            {language.t("dialog.vhoFeedback.resolving")}
                          </Match>
                          <Match when={true}>{language.t("dialog.vhoFeedback.select")}</Match>
                        </Switch>
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-12-regular text-text-weak">
            {language.t("dialog.vhoFeedback.pagination", {
              page: store.page_num,
              total: totalPages(),
              count: store.total,
            })}
          </div>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={loading() || store.page_num <= 1}
              onClick={() => void search(store.page_num - 1)}
            >
              {language.t("dialog.vhoFeedback.prev")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={loading() || store.page_num >= totalPages()}
              onClick={() => void search(store.page_num + 1)}
            >
              {language.t("dialog.vhoFeedback.next")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
