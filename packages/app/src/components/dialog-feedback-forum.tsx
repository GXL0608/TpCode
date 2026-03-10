import { useLocation } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { useGlobalSDK } from "@/context/global-sdk"
import { feedbackPageName, feedbackPlatform, type FeedbackSourcePlatform, type FeedbackStatus } from "./feedback-helpers"

type Thread = {
  id: string
  project_id: string
  product_id: string
  product_name: string
  page_name: string
  menu_path?: string
  source_platform: FeedbackSourcePlatform
  user_id: string
  username: string
  display_name: string
  org_id: string
  department_id?: string
  title: string
  content: string
  status: FeedbackStatus
  resolved_by?: string
  resolved_name?: string
  resolved_at?: number
  last_reply_at: number
  reply_count: number
  time_created: number
  time_updated: number
}

type Post = {
  id: string
  thread_id: string
  user_id: string
  username: string
  display_name: string
  org_id: string
  department_id?: string
  content: string
  official_reply: boolean
  time_created: number
  time_updated: number
}

type Detail = {
  ok: true
  thread: Thread
  posts: Post[]
}

function label(status: FeedbackStatus) {
  if (status === "resolved") return "已解决"
  if (status === "processing") return "处理中"
  return "待处理"
}

function tone(status: FeedbackStatus) {
  if (status === "resolved") return "text-icon-success-base bg-icon-success-base/10"
  if (status === "processing") return "text-icon-warning-base bg-icon-warning-base/10"
  return "text-text-strong bg-surface-panel"
}

function platform(value: FeedbackSourcePlatform) {
  if (value === "mobile_web") return "手机端"
  return "PC Web"
}

function time(value?: number) {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function unwrap<T>(result: { data?: T; error?: unknown }) {
  if (result.data !== undefined) return result.data
  if (result.error instanceof Error) throw result.error
  throw new Error("request_failed")
}

export const DialogFeedbackForum: Component = () => {
  const sdk = useGlobalSDK()
  const auth = useAccountAuth()
  const dialog = useDialog()
  const location = useLocation()
  const [width, setWidth] = createSignal(typeof window === "object" ? window.innerWidth : 1280)
  const [store, setStore] = createStore({
    loading_list: false,
    loading_detail: false,
    creating: false,
    replying: false,
    updating: false,
    items: [] as Thread[],
    current: undefined as Detail | undefined,
    selected: undefined as string | undefined,
    view: "list" as "list" | "detail" | "create",
    filter_status: "all" as "all" | FeedbackStatus,
    filter_mine: false,
    title: "",
    content: "",
    reply: "",
  })

  const mobile = createMemo(() => feedbackPlatform(width()) === "mobile_web")
  const current = createMemo(() => store.current?.thread)
  const posts = createMemo(() => store.current?.posts ?? [])
  const canResolve = createMemo(() => auth.has("feedback:resolve"))
  const meta = createMemo(() => ({
    page_name: feedbackPageName({
      title: typeof document === "object" ? document.title : undefined,
      path: location.pathname,
    }),
    menu_path: location.pathname,
    source_platform: feedbackPlatform(width()),
  }))

  const fail = (title: string, error: unknown) => {
    const description = error instanceof Error ? error.message : String(error)
    showToast({ title, description })
  }

  const list = async (pick?: string) => {
    setStore("loading_list", true)
    try {
      const items = unwrap(
        await sdk.client.feedback.list({
          status: store.filter_status === "all" ? undefined : store.filter_status,
          mine: store.filter_mine || undefined,
          limit: 100,
        }),
      )
      setStore("items", items)
      const id = pick ?? store.selected
      if (id && items.some((item) => item.id === id)) {
        await detail(id)
        return
      }
      if (!mobile() && store.view !== "create" && items[0]) {
        await detail(items[0].id)
        return
      }
      if (items.length === 0) {
        setStore("selected", undefined)
        setStore("current", undefined)
        if (!mobile()) setStore("view", "create")
      }
    } catch (error) {
      fail("反馈列表加载失败", error)
    } finally {
      setStore("loading_list", false)
    }
  }

  const detail = async (thread_id: string) => {
    setStore("selected", thread_id)
    setStore("view", "detail")
    setStore("loading_detail", true)
    try {
      const result = unwrap(await sdk.client.feedback.get({ thread_id }))
      setStore("current", result)
    } catch (error) {
      fail("反馈详情加载失败", error)
    } finally {
      setStore("loading_detail", false)
    }
  }

  const submit = async () => {
    if (store.creating) return
    if (!store.title.trim() || !store.content.trim()) return
    setStore("creating", true)
    try {
      const result = unwrap(
        await sdk.client.feedback.create({
          title: store.title,
          content: store.content,
          page_name: meta().page_name,
          menu_path: meta().menu_path,
          source_platform: meta().source_platform,
        }),
      )
      setStore("title", "")
      setStore("content", "")
      setStore("view", "detail")
      await list(result.thread.id)
      showToast({ title: "反馈已提交" })
    } catch (error) {
      fail("反馈提交失败", error)
    } finally {
      setStore("creating", false)
    }
  }

  const reply = async () => {
    if (store.replying) return
    if (!store.selected || !store.reply.trim()) return
    setStore("replying", true)
    try {
      unwrap(
        await sdk.client.feedback.reply({
          thread_id: store.selected,
          content: store.reply,
        }),
      )
      setStore("reply", "")
      await list(store.selected)
    } catch (error) {
      fail("回复失败", error)
    } finally {
      setStore("replying", false)
    }
  }

  const update = async (status: FeedbackStatus) => {
    if (store.updating) return
    if (!store.selected) return
    setStore("updating", true)
    try {
      unwrap(
        await sdk.client.feedback.updateStatus({
          thread_id: store.selected,
          status,
        }),
      )
      await list(store.selected)
    } catch (error) {
      fail("状态更新失败", error)
    } finally {
      setStore("updating", false)
    }
  }

  const openCreate = () => {
    setStore("current", undefined)
    setStore("selected", undefined)
    setStore("view", "create")
  }

  const setStatus = (value: "all" | FeedbackStatus) => {
    setStore("filter_status", value)
    void list()
  }

  const setMine = (value: boolean) => {
    setStore("filter_mine", value)
    void list()
  }

  onMount(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener("resize", resize)
    onCleanup(() => {
      window.removeEventListener("resize", resize)
    })
    void list()
  })

  const threadMeta = (item: Thread) => (
    <div class="flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
      <span>{item.display_name}</span>
      <span>{time(item.time_created)}</span>
      <span>{item.product_name}</span>
      <span>{item.page_name}</span>
    </div>
  )

  const listPane = (
    <div class="w-full md:w-[340px] min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-border-weak-base bg-surface-panel/20">
      <div class="px-4 py-4 border-b border-border-weak-base flex items-center justify-between gap-3">
        <div>
          <div class="text-16-medium text-text-strong">反馈论坛</div>
          <div class="text-12-regular text-text-weak">同产品用户可见，可直接追问与回复。</div>
        </div>
        <Button size="small" onClick={openCreate}>
          我要提问
        </Button>
      </div>
      <div class="px-4 py-3 border-b border-border-weak-base flex flex-wrap gap-2">
        <Button size="small" variant={store.filter_status === "all" ? "primary" : "ghost"} onClick={() => setStatus("all")}>
          全部
        </Button>
        <Button
          size="small"
          variant={store.filter_status === "open" ? "primary" : "ghost"}
          onClick={() => setStatus("open")}
        >
          待处理
        </Button>
        <Button
          size="small"
          variant={store.filter_status === "processing" ? "primary" : "ghost"}
          onClick={() => setStatus("processing")}
        >
          处理中
        </Button>
        <Button
          size="small"
          variant={store.filter_status === "resolved" ? "primary" : "ghost"}
          onClick={() => setStatus("resolved")}
        >
          已解决
        </Button>
        <label class="ml-auto flex items-center gap-2 text-12-regular text-text-weak">
          <input
            type="checkbox"
            checked={store.filter_mine}
            onChange={(event) => setMine(event.currentTarget.checked)}
          />
          只看我提的
        </label>
      </div>
      <div class="flex-1 overflow-y-auto">
        <Show when={!store.loading_list} fallback={<div class="px-4 py-6 text-13-regular text-text-weak">加载中...</div>}>
          <Show
            when={store.items.length > 0}
            fallback={<div class="px-4 py-8 text-13-regular text-text-weak">还没有反馈帖，先提交第一个问题。</div>}
          >
            <For each={store.items}>
              {(item) => (
                <button
                  type="button"
                  classList={{
                    "w-full px-4 py-4 text-left border-b border-border-weak-base/70 hover:bg-surface-panel/50 transition-colors": true,
                    "bg-surface-panel/60": store.selected === item.id && store.view !== "create",
                  }}
                  onClick={() => void detail(item.id)}
                >
                  <div class="flex items-start gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="text-14-medium text-text-strong line-clamp-2">{item.title}</div>
                      <div class="mt-2">{threadMeta(item)}</div>
                      <div class="mt-2 text-13-regular text-text-weak line-clamp-2">{item.content}</div>
                    </div>
                    <div class={`shrink-0 rounded-full px-2 py-1 text-11-medium ${tone(item.status)}`}>{label(item.status)}</div>
                  </div>
                  <div class="mt-3 flex items-center justify-between text-12-regular text-text-weak">
                    <span>{item.reply_count} 条回复</span>
                    <span>最后更新 {time(item.last_reply_at)}</span>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )

  const createPane = (
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="px-4 py-4 border-b border-border-weak-base flex items-center justify-between">
        <div>
          <div class="text-16-medium text-text-strong">提交反馈</div>
          <div class="text-12-regular text-text-weak">标题和问题内容必填，页面上下文自动带入。</div>
        </div>
        <Show when={mobile()}>
          <Button variant="ghost" size="small" onClick={() => setStore("view", "list")}>
            返回列表
          </Button>
        </Show>
      </div>
      <form
        class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label class="flex flex-col gap-2">
          <span class="text-13-medium text-text-strong">标题</span>
          <input
            value={store.title}
            onInput={(event) => setStore("title", event.currentTarget.value)}
            placeholder="请输入问题标题"
            class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          />
        </label>
        <label class="flex flex-col gap-2">
          <span class="text-13-medium text-text-strong">问题内容</span>
          <textarea
            value={store.content}
            onInput={(event) => setStore("content", event.currentTarget.value)}
            placeholder="请描述你遇到的问题、期望结果和复现步骤"
            class="min-h-40 rounded-md border border-border-weak-base bg-surface-base px-3 py-3 text-14-regular"
          />
        </label>
        <div class="rounded-xl border border-border-weak-base bg-surface-panel/35 px-4 py-4 flex flex-col gap-2">
          <div class="text-13-medium text-text-strong">自动带入的上下文</div>
          <div class="text-13-regular text-text-weak">产品范围：当前已选择产品</div>
          <div class="text-13-regular text-text-weak">页面名称：{meta().page_name}</div>
          <div class="text-13-regular text-text-weak">菜单路径：{meta().menu_path}</div>
          <div class="text-13-regular text-text-weak">来源平台：{platform(meta().source_platform)}</div>
        </div>
        <div class="pt-2 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => (mobile() ? setStore("view", "list") : dialog.close())}>
            取消
          </Button>
          <Button type="submit" disabled={store.creating || !store.title.trim() || !store.content.trim()}>
            {store.creating ? "提交中..." : "提交反馈"}
          </Button>
        </div>
      </form>
    </div>
  )

  const detailPane = (
    <div class="flex-1 min-h-0 flex flex-col">
      <Show
        when={current()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-13-regular text-text-weak">
            {store.loading_detail ? "加载中..." : "请选择一条反馈，或者新建问题。"}
          </div>
        }
      >
        {(item) => (
          <>
            <div class="px-4 py-4 border-b border-border-weak-base flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-18-medium text-text-strong">{item().title}</div>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
                  <span>{item().display_name}</span>
                  <span>{time(item().time_created)}</span>
                  <span>{item().product_name}</span>
                  <span>{item().page_name}</span>
                  <span>{platform(item().source_platform)}</span>
                </div>
                <Show when={item().resolved_name}>
                  <div class="mt-2 text-12-regular text-text-weak">
                    结单人：{item().resolved_name} {time(item().resolved_at)}
                  </div>
                </Show>
              </div>
              <div class="flex flex-col items-end gap-2">
                <div class={`rounded-full px-2.5 py-1 text-11-medium ${tone(item().status)}`}>{label(item().status)}</div>
                <Show when={mobile()}>
                  <Button variant="ghost" size="small" onClick={() => setStore("view", "list")}>
                    返回列表
                  </Button>
                </Show>
              </div>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
              <div class="rounded-xl border border-border-weak-base bg-surface-base px-4 py-4">
                <div class="text-13-medium text-text-strong">问题内容</div>
                <div class="mt-3 whitespace-pre-wrap text-14-regular text-text-base">{item().content}</div>
                <Show when={item().menu_path}>
                  <div class="mt-3 text-12-regular text-text-weak">菜单路径：{item().menu_path}</div>
                </Show>
              </div>
              <Show when={canResolve()}>
                <div class="rounded-xl border border-border-weak-base bg-surface-panel/35 px-4 py-4 flex flex-wrap gap-2">
                  <Button
                    size="small"
                    variant={item().status === "processing" ? "primary" : "ghost"}
                    disabled={store.updating}
                    onClick={() => void update("processing")}
                  >
                    标记处理中
                  </Button>
                  <Button
                    size="small"
                    variant={item().status === "resolved" ? "primary" : "ghost"}
                    disabled={store.updating}
                    onClick={() => void update("resolved")}
                  >
                    标记已解决
                  </Button>
                  <Button size="small" variant="ghost" disabled={store.updating} onClick={() => void update("open")}>
                    重新打开
                  </Button>
                </div>
              </Show>
              <div class="flex flex-col gap-3">
                <div class="text-13-medium text-text-strong">回复记录</div>
                <For each={posts()}>
                  {(reply) => (
                    <div class="rounded-xl border border-border-weak-base bg-surface-base px-4 py-4">
                      <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2 text-13-medium text-text-strong">
                          <span>{reply.display_name}</span>
                          <Show when={reply.official_reply}>
                            <span class="rounded-full px-2 py-0.5 text-11-medium text-icon-warning-base bg-icon-warning-base/10">
                              官方回复
                            </span>
                          </Show>
                        </div>
                        <div class="text-12-regular text-text-weak">{time(reply.time_created)}</div>
                      </div>
                      <div class="mt-3 whitespace-pre-wrap text-14-regular text-text-base">{reply.content}</div>
                    </div>
                  )}
                </For>
                <Show when={posts().length === 0}>
                  <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-6 text-13-regular text-text-weak">
                    还没有回复，欢迎补充更多信息。
                  </div>
                </Show>
              </div>
            </div>
            <div class="border-t border-border-weak-base px-4 py-4 flex flex-col gap-3 bg-surface-panel/20">
              <textarea
                value={store.reply}
                onInput={(event) => setStore("reply", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return
                  event.preventDefault()
                  void reply()
                }}
                placeholder="输入回复内容，Ctrl/Cmd + Enter 提交"
                class="min-h-28 rounded-md border border-border-weak-base bg-surface-base px-3 py-3 text-14-regular"
              />
              <div class="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setStore("reply", "")}>
                  清空
                </Button>
                <Button disabled={store.replying || !store.reply.trim()} onClick={() => void reply()}>
                  {store.replying ? "提交中..." : "提交回复"}
                </Button>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  )

  return (
    <Dialog
      title="反馈论坛"
      size="xx-large"
      transition
      class="max-sm:rounded-none max-sm:min-h-[calc(100vh-16px)]"
    >
      <Show when={mobile()} fallback={<div class="h-full flex min-h-0">{listPane}<Show when={store.view === "create"} fallback={detailPane}>{createPane}</Show></div>}>
        <Show when={store.view === "create"} fallback={<Show when={store.view === "detail"} fallback={listPane}>{detailPane}</Show>}>
          {createPane}
        </Show>
      </Show>
    </Dialog>
  )
}
