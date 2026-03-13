import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createSignal, For, Match, Show, Switch, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { useLanguage } from "@/context/language"
import { createIsDesktop } from "@/utils/device-detection"
import {
  buildVhoFeedbackFilters,
  type VhoFeedbackApplyResult,
  VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS,
  VHO_FEEDBACK_DIALOG_BODY_CLASS,
  VHO_FEEDBACK_FILTER_ACTIONS_CLASS,
  VHO_FEEDBACK_FOOTER_CLASS,
  VHO_FEEDBACK_LIST_SCROLL_CLASS,
  VHO_FEEDBACK_PAGE_SIZES,
  VHO_FEEDBACK_RESOLUTION_OPTIONS,
  vhoFeedbackResolutionKey,
  vhoFeedbackTodayValue,
} from "./vho-feedback"

type Props = {
  onSelect: (input: {
    prompt_text: string
    feedback_des: string
    plan_content: string
    project_id: string
    project_worktree: string
    project_name?: string
  }) => Promise<VhoFeedbackApplyResult>
}

/**
 * 中文注释：在 build 模式下检索 VHO 反馈并把选中结果回填到会话输入框。
 */
export const DialogVhoFeedback: Component<Props> = (props) => {
  const auth = useAccountAuth()
  const language = useLanguage()
  const dialog = useDialog()
  const isDesktop = createIsDesktop()
  const today = vhoFeedbackTodayValue()
  const defaults = () => buildVhoFeedbackFilters(today)
  const [advanced, setAdvanced] = createSignal(false)
  const [advancedTouched, setAdvancedTouched] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [resolving, setResolving] = createSignal("")
  const [store, setStore] = createStore({
    ...defaults(),
    resolution_status: [...VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS] as Array<"0" | "1" | "9">,
    list: [] as Array<{
      feedback_id: string
      plan_id?: string
      feedback_des?: string
      customer_name?: string
      product_name?: string
      module_name?: string
      function_name?: string
      user_name?: string
      feedback_time?: string
      resolution_status_name?: string
      rd_task_status?: string
      demand_type_name?: string
      [key: string]: unknown
    }>,
    error: "",
  })

  type Filters = {
    user_id: string
    feedback_id: string
    plan_id: string
    feedback_des: string
    resolution_status: Array<"0" | "1" | "9">
    plan_start_date: string
    plan_end_date: string
    page_num: number
    page_size: number
  }

  const inputClass =
    "rounded-md border border-border-weak-base bg-background px-3 py-2 text-13-regular placeholder:text-text-weak"
  const selectClass = `${inputClass} h-10`

  /**
   * 中文注释：渲染高级筛选项标题，明确每个输入框对应的接口字段语义。
   */
  const filterLabel = (key: string) => <div class="text-11-medium text-text-weak">{language.t(key)}</div>

  /**
   * 中文注释：筛选并拼装反馈列表中优先展示的关键业务字段。
   */
  const detail = (keys: Array<{
    label: string
    value?: string
  }>) => keys.filter((row) => !!row.value?.trim())

  /**
   * 中文注释：切换多选解决状态，保证请求只会发送受支持的枚举值。
   */
  const toggleResolutionStatus = (value: "0" | "1" | "9") => {
    const next = store.resolution_status.includes(value)
      ? store.resolution_status.filter((item) => item !== value)
      : [...store.resolution_status, value]
    setStore("resolution_status", next)
  }

  /**
   * 中文注释：点击日期输入框任意位置时优先唤起原生日期选择器，避免只能点日历图标。
   */
  const openDatePicker = (event: MouseEvent & { currentTarget: HTMLInputElement }) => {
    event.currentTarget.showPicker?.()
  }

  /**
   * 中文注释：统一执行列表查询，并在失败时把错误留在弹窗内。
   */
  const search = async (value: Filters) => {
    setLoading(true)
    setStore("error", "")
    const result = await auth.listVhoFeedback(value)
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
   * 中文注释：从当前弹窗状态生成一次查询快照，避免异步 setStore 后读取到旧值。
   */
  const filters = (patch?: Partial<Filters>): Filters => ({
    user_id: patch?.user_id ?? store.user_id,
    feedback_id: patch?.feedback_id ?? store.feedback_id,
    plan_id: patch?.plan_id ?? store.plan_id,
    feedback_des: patch?.feedback_des ?? store.feedback_des,
    resolution_status: patch?.resolution_status ?? [...store.resolution_status],
    plan_start_date: patch?.plan_start_date ?? store.plan_start_date,
    plan_end_date: patch?.plan_end_date ?? store.plan_end_date,
    page_num: patch?.page_num ?? store.page_num,
    page_size: patch?.page_size ?? store.page_size,
  })

  onMount(() => {
    void search(filters({ page_num: 1 }))
  })

  /**
   * 中文注释：在用户未手动切换前，让高级筛选默认展开状态跟随当前设备形态变化。
   */
  createEffect(() => {
    if (advancedTouched()) return
    setAdvanced(isDesktop())
  })

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
    const applied = await props.onSelect(result)
    if (!applied.ok) {
      setStore("error", applied.message)
      return
    }
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("dialog.vhoFeedback.select.successProject"),
    })
  }

  const totalPages = () => Math.max(1, Math.ceil(store.total / Math.max(store.page_size, 1)))

  return (
    <Dialog
      title={language.t("dialog.vhoFeedback.title")}
      description={language.t("dialog.vhoFeedback.description")}
      size="xx-large"
    >
      <div class={VHO_FEEDBACK_DIALOG_BODY_CLASS}>
        <div class="grid gap-3 md:grid-cols-4">
          <input
            class={inputClass}
            value={store.user_id}
            placeholder={language.t("dialog.vhoFeedback.userId")}
            onInput={(event) => setStore("user_id", event.currentTarget.value)}
          />
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

        <div class="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => {
              setAdvancedTouched(true)
              setAdvanced((value) => !value)
            }}
          >
            {advanced()
              ? language.t("dialog.vhoFeedback.advanced.hide")
              : language.t("dialog.vhoFeedback.advanced.show")}
          </Button>
        </div>

        <Show when={advanced()}>
          <div class="grid gap-3 rounded-lg border border-border-weak-base bg-surface-panel p-3 md:grid-cols-3">
            <label class="grid gap-1">
              {filterLabel("dialog.vhoFeedback.resolutionStatus")}
              <div class="flex min-h-10 flex-wrap gap-2 rounded-md border border-border-weak-base bg-background px-3 py-2">
                <For each={VHO_FEEDBACK_RESOLUTION_OPTIONS.filter((item) => item)}>
                  {(item) => (
                    <label class="flex items-center gap-2 text-12-regular text-text-strong">
                      <input
                        type="checkbox"
                        checked={store.resolution_status.includes(item as "0" | "1" | "9")}
                        onChange={() => toggleResolutionStatus(item as "0" | "1" | "9")}
                      />
                      <span>{language.t(vhoFeedbackResolutionKey(item))}</span>
                    </label>
                  )}
                </For>
              </div>
            </label>
            <label class="grid gap-1">
              {filterLabel("dialog.vhoFeedback.planStartDate")}
              <input
                class={`${inputClass} h-10`}
                value={store.plan_start_date}
                type="date"
                onClick={openDatePicker}
                onInput={(event) => setStore("plan_start_date", event.currentTarget.value)}
              />
            </label>
            <label class="grid gap-1">
              {filterLabel("dialog.vhoFeedback.planEndDate")}
              <input
                class={`${inputClass} h-10`}
                value={store.plan_end_date}
                type="date"
                onClick={openDatePicker}
                onInput={(event) => setStore("plan_end_date", event.currentTarget.value)}
              />
            </label>
          </div>
        </Show>

        <div class={VHO_FEEDBACK_FILTER_ACTIONS_CLASS}>
          <Button
            type="button"
            size="small"
            onClick={() => void search(filters({ page_num: 1 }))}
            disabled={loading()}
          >
            {loading() ? language.t("dialog.vhoFeedback.searching") : language.t("dialog.vhoFeedback.search")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              const next = defaults()
              setStore({
                user_id: next.user_id,
                feedback_id: next.feedback_id,
                plan_id: next.plan_id,
                feedback_des: next.feedback_des,
                resolution_status: [...VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS],
                plan_start_date: next.plan_start_date,
                plan_end_date: next.plan_end_date,
                page_num: 1,
                page_size: next.page_size,
                total: 0,
                list: [],
                error: "",
              })
              void search({
                user_id: next.user_id,
                feedback_id: next.feedback_id,
                plan_id: next.plan_id,
                feedback_des: next.feedback_des,
                resolution_status: [...VHO_FEEDBACK_DEFAULT_RESOLUTION_OPTIONS],
                plan_start_date: next.plan_start_date,
                plan_end_date: next.plan_end_date,
                page_num: 1,
                page_size: next.page_size,
              })
            }}
          >
            {language.t("dialog.vhoFeedback.reset")}
          </Button>
        </div>

        <Show when={store.error}>
          {(value) => (
            <div class="rounded-md bg-danger-base/10 px-3 py-2 text-12-regular text-danger-base">{value()}</div>
          )}
        </Show>

        <div class="min-h-[280px] overflow-hidden rounded-lg border border-border-weak-base md:flex-1 md:min-h-0">
          <Show
            when={store.list.length > 0}
            fallback={
              <div class="flex h-full min-h-0 items-center justify-center px-4 text-12-regular text-text-weak">
                {loading() ? language.t("dialog.vhoFeedback.searching") : language.t("dialog.vhoFeedback.empty")}
              </div>
            }
          >
            <div class={`${VHO_FEEDBACK_LIST_SCROLL_CLASS} grid divide-y divide-border-weak-base`}>
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
                      <div class="mt-2 flex flex-wrap gap-2 text-11-regular text-text-weak">
                        <For
                          each={detail([
                            { label: language.t("dialog.vhoFeedback.customer"), value: item.customer_name },
                            { label: language.t("dialog.vhoFeedback.product"), value: item.product_name },
                            { label: language.t("dialog.vhoFeedback.module"), value: item.module_name },
                            { label: language.t("dialog.vhoFeedback.function"), value: item.function_name },
                          ])}
                        >
                          {(row) => (
                            <span class="rounded-full bg-surface-panel px-2 py-0.5">
                              {row.label}: {row.value}
                            </span>
                          )}
                        </For>
                      </div>
                      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weak">
                        <For
                          each={detail([
                            { label: language.t("dialog.vhoFeedback.feedbackUser"), value: item.user_name },
                            { label: language.t("dialog.vhoFeedback.feedbackTime"), value: item.feedback_time },
                            { label: language.t("dialog.vhoFeedback.status"), value: item.resolution_status_name },
                            { label: language.t("dialog.vhoFeedback.rdTaskStatus"), value: item.rd_task_status },
                            { label: language.t("dialog.vhoFeedback.demandType"), value: item.demand_type_name },
                          ])}
                        >
                          {(row) => (
                            <span>
                              {row.label}: {row.value}
                            </span>
                          )}
                        </For>
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

        <div class={VHO_FEEDBACK_FOOTER_CLASS}>
          <div class="text-12-regular text-text-weak">
            {language.t("dialog.vhoFeedback.pagination", {
              page: store.page_num,
              total: totalPages(),
              count: store.total,
            })}
          </div>
          <div class="flex items-center gap-2">
            <select
              class={`${selectClass} w-24`}
              value={String(store.page_size)}
              onChange={(event) => {
                const page_size = Number(event.currentTarget.value || 50)
                setStore({
                  page_size,
                  page_num: 1,
                })
                void search(filters({ page_size, page_num: 1 }))
              }}
            >
              <For each={VHO_FEEDBACK_PAGE_SIZES}>
                {(item) => <option value={String(item)}>{item}</option>}
              </For>
            </select>
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={loading() || store.page_num <= 1}
              onClick={() => void search(filters({ page_num: store.page_num - 1 }))}
            >
              {language.t("dialog.vhoFeedback.prev")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={loading() || store.page_num >= totalPages()}
              onClick={() => void search(filters({ page_num: store.page_num + 1 }))}
            >
              {language.t("dialog.vhoFeedback.next")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
