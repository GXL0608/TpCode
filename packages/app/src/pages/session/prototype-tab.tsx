import { Button } from "@opencode-ai/ui/button"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { AccountToken } from "@/utils/account-auth"

type PrototypeItem = {
  id: string
  title: string
  description?: string
  route?: string
  page_key: string
  version: number
  is_latest: boolean
  storage_key: string
  image_url: string
  thumbnail_url: string
  source_type: "manual_upload" | "playwright_capture"
  test_result?: "passed" | "failed" | "unknown"
  time_created: number
}

function formatTime(input: number) {
  return new Date(input).toLocaleString()
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      resolve(result.split(",").at(-1) ?? "")
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function toPageKey(input: string) {
  return input
    .trim()
    .replace(/[\\/\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function PrototypeTab() {
  const params = useParams()
  const sdk = useSDK()
  const auth = useAccountAuth()
  const local = useLocal()

  let fileRef: HTMLInputElement | undefined

  const [title, setTitle] = createSignal("")
  const [pageKey, setPageKey] = createSignal("")
  const [route, setRoute] = createSignal("")
  const [sourceUrl, setSourceUrl] = createSignal("http://localhost:5173/prototype")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [removing, setRemoving] = createSignal<string>()
  const [picked, setPicked] = createSignal<File>()
  const [pageKeyEdited, setPageKeyEdited] = createSignal(false)
  const [saveMode, setSaveMode] = createSignal<"upload" | "capture">("upload")

  const token = createMemo(() => AccountToken.access())
  const currentMode = createMemo(() => local.agent.current()?.name ?? "unknown")
  const modeLabel = createMemo(() => {
    if (currentMode() === "build") return "构建"
    if (currentMode() === "plan") return "计划"
    return currentMode()
  })
  const isBuild = createMemo(() => currentMode() === "build")
  const hasGenerate = createMemo(() => !auth.user() || auth.has("code:generate"))
  const canSave = createMemo(() => isBuild() && hasGenerate())
  const baseReady = createMemo(() => !!title().trim() && !!pageKey().trim() && !!route().trim())
  const canUpload = createMemo(() => canSave() && baseReady() && !!picked())
  const canCapture = createMemo(() => canSave() && baseReady() && !!sourceUrl().trim())
  const blocked = createMemo(() => {
    const list: string[] = []
    if (!isBuild()) list.push(`当前模式是 ${modeLabel()}，需要切换到构建模式`)
    if (!hasGenerate()) list.push("当前账号缺少 code:generate 权限")
    return list
  })
  const inputClass =
    "rounded-md border border-border-weak-base bg-background px-3 py-2 text-13-regular placeholder:text-text-weak focus:placeholder:text-transparent disabled:opacity-60"

  createEffect(() => {
    if (pageKeyEdited()) return
    setPageKey(toPageKey(route()))
  })

  createEffect(() => {
    saveMode()
    setError(undefined)
  })

  const endpoint = (input: string) => new URL(input, sdk.url).toString()

  const resetForm = () => {
    setTitle("")
    setRoute("")
    setPageKey("")
    setPageKeyEdited(false)
    setSourceUrl("http://localhost:5173/prototype")
    setPicked(undefined)
    if (fileRef) fileRef.value = ""
  }

  const request = async <T,>(input: {
    path: string
    method?: string
    body?: Record<string, unknown>
  }) => {
    const headers = new Headers()
    headers.set("accept", "application/json")
    if (token()) headers.set("authorization", `Bearer ${token()}`)
    if (input.body) headers.set("content-type", "application/json")
    const response = await fetch(endpoint(input.path), {
      method: input.method ?? "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | { error?: string; code?: string; message?: string }
        | undefined
      throw new Error(body?.message ?? body?.code ?? body?.error ?? `request_failed_${response.status}`)
    }
    return (await response.json()) as T
  }

  const [items, action] = createResource(
    () => params.id,
    async (id) => {
      if (!id) return [] as PrototypeItem[]
      const result = await request<{ items: PrototypeItem[] }>({
        path: `/session/${id}/prototype`,
      })
      return result.items
    },
  )

  const image = (item: PrototypeItem, variant: "original" | "thumbnail") => {
    const url = new URL(variant === "thumbnail" ? item.thumbnail_url : item.image_url, sdk.url)
    if (token()) url.searchParams.set("access_token", token()!)
    return url.toString()
  }

  const validate = (mode: "upload" | "capture") => {
    if (!title().trim()) {
      setError("请先填写原型标题")
      return false
    }
    if (!route().trim()) {
      setError("请先填写页面路由")
      return false
    }
    if (!pageKey().trim()) {
      setError("请先填写页面编码")
      return false
    }
    if (mode === "upload" && !picked()) {
      setError("上传保存时必须选择原型图片")
      return false
    }
    if (mode === "capture" && !sourceUrl().trim()) {
      setError("截图保存时必须填写截图地址")
      return false
    }
    return true
  }

  const upload = async () => {
    const id = params.id
    const file = picked()
    if (!id || !file || !validate("upload")) return
    setBusy(true)
    setError(undefined)
    try {
      await request({
        path: `/session/${id}/prototype/upload`,
        method: "POST",
        body: {
          agent_mode: currentMode(),
          title: title().trim(),
          page_key: pageKey().trim(),
          route: route().trim(),
          filename: file.name,
          content_type: file.type || "image/png",
          data_base64: await toBase64(file),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            device_scale_factor: Math.max(1, Math.round(window.devicePixelRatio || 1)),
          },
        },
      })
      await action.refetch()
      resetForm()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const capture = async () => {
    const id = params.id
    if (!id || !validate("capture")) return
    setBusy(true)
    setError(undefined)
    try {
      await request({
        path: `/session/${id}/prototype/capture`,
        method: "POST",
        body: {
          agent_mode: currentMode(),
          title: title().trim(),
          page_key: pageKey().trim(),
          route: route().trim(),
          source_url: sourceUrl().trim(),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            device_scale_factor: Math.max(1, Math.round(window.devicePixelRatio || 1)),
          },
        },
      })
      await action.refetch()
      resetForm()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: PrototypeItem) => {
    if (!window.confirm(`确认删除原型图“${item.title}”吗？`)) return
    setRemoving(item.id)
    setError(undefined)
    try {
      await request({
        path: `/prototype/${item.id}`,
        method: "DELETE",
      })
      await action.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRemoving(undefined)
    }
  }

  return (
    <div class="h-full overflow-auto bg-background px-3 py-3">
      <div class="flex flex-col gap-3">
        <Show when={isBuild()}>
          <section class="rounded-lg border border-border-weak-base bg-surface-panel p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="text-13-medium text-text-strong">原型上传</div>
              <div class="shrink-0 text-11-regular text-text-weak">模式：{modeLabel()}</div>
            </div>

            <Show when={blocked().length > 0}>
              <div class="mt-3 rounded-md border border-warning-base/30 bg-warning-base/10 px-3 py-2 text-12-regular text-text-weak">
                <For each={blocked()}>{(item) => <div>{item}</div>}</For>
              </div>
            </Show>

            <div class="mt-3 flex gap-2">
              <Button
                size="small"
                variant={saveMode() === "upload" ? "primary" : "ghost"}
                disabled={!canSave()}
                onClick={() => setSaveMode("upload")}
              >
                上传图片
              </Button>
              <Button
                size="small"
                variant={saveMode() === "capture" ? "primary" : "ghost"}
                disabled
                onClick={() => setSaveMode("capture")}
              >
                截图保存
              </Button>
            </div>

            <div class="mt-3 grid gap-3">
              <div class="grid gap-1">
                <div class="flex items-center gap-2 text-12-medium text-text-strong">
                  <span>原型标题</span>
                  <span class="text-danger-base">*</span>
                  <span class="text-11-regular text-text-weak">必填，用于显示这张原型图的名称</span>
                </div>
                <input
                  value={title()}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                  disabled={!canSave()}
                  class={inputClass}
                  placeholder="例如：门诊医师工作台原型"
                />
              </div>

              <div class="grid gap-1">
                <div class="flex items-center gap-2 text-12-medium text-text-strong">
                  <span>页面路由</span>
                  <span class="text-danger-base">*</span>
                  <span class="text-11-regular text-text-weak">必填，记录这张原型图对应的业务菜单或页面路径</span>
                </div>
                <input
                  value={route()}
                  onInput={(event) => setRoute(event.currentTarget.value)}
                  disabled={!canSave()}
                  class={inputClass}
                  placeholder="门诊业务/门诊医师"
                />
              </div>

              <div class="grid gap-1">
                <div class="flex items-center gap-2 text-12-medium text-text-strong">
                  <span>页面编码</span>
                  <span class="text-danger-base">*</span>
                  <span class="text-11-regular text-text-weak">默认按页面路由自动生成，后期也可以改成任务号</span>
                </div>
                <input
                  value={pageKey()}
                  onInput={(event) => {
                    setPageKeyEdited(true)
                    setPageKey(event.currentTarget.value)
                  }}
                  disabled={!canSave()}
                  class={inputClass}
                  placeholder="会根据页面路由自动生成"
                />
              </div>

              <Show when={saveMode() === "capture"}>
                <div class="grid gap-1">
                  <div class="flex items-center gap-2 text-12-medium text-text-strong">
                    <span>截图地址</span>
                    <span class="text-11-regular text-text-weak">截图保存时使用，默认本地开发地址，可直接修改</span>
                  </div>
                  <input
                    value={sourceUrl()}
                    onInput={(event) => setSourceUrl(event.currentTarget.value)}
                    disabled={!canSave()}
                    class={inputClass}
                    placeholder="例如：http://localhost:5173/prototype"
                  />
                </div>
              </Show>

              <Show when={saveMode() === "upload"}>
                <div class="grid gap-2">
                  <div class="flex items-center gap-2 text-12-medium text-text-strong">
                    <span>原型图片</span>
                    <span class="text-11-regular text-text-weak">上传保存时必填，支持 png、jpg、webp</span>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canSave()}
                    onChange={(event) => setPicked(event.currentTarget.files?.[0])}
                    class="hidden"
                  />
                  <button
                    type="button"
                    disabled={!canSave()}
                    onClick={() => fileRef?.click()}
                    class="flex w-full items-center justify-between rounded-lg border border-dashed border-border-strong bg-background px-3 py-3 text-left transition-colors hover:bg-surface-panel disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div class="flex flex-col gap-1">
                      <div class="text-13-medium text-text-strong">点击选择原型图片</div>
                      <div class="text-12-regular text-text-weak">
                        <Show when={picked()} fallback="未选择文件">
                          {(file) => `已选择：${file().name}`}
                        </Show>
                      </div>
                    </div>
                    <div class="rounded-md border border-border-weak-base bg-surface-panel px-3 py-1 text-12-medium text-text-strong">
                      选择文件
                    </div>
                  </button>
                </div>
              </Show>
            </div>

            <Show when={error()}>
              {(value) => <div class="mt-3 text-12-regular text-danger-base">{value()}</div>}
            </Show>

            <div class="mt-3 flex gap-2">
              <Show
                when={saveMode() === "upload"}
                fallback={
                  <Button size="small" disabled={!canCapture() || busy()} onClick={capture}>
                    截图保存
                  </Button>
                }
              >
                <Button size="small" disabled={!canUpload() || busy()} onClick={upload}>
                  上传保存
                </Button>
              </Show>
            </div>
          </section>
        </Show>

        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-13-medium text-text-strong">{isBuild() ? "已保存原型图" : "原型图"}</div>
            <div class="text-11-regular text-text-weak">模式：{modeLabel()}</div>
          </div>

          <Show
            when={!items.loading}
            fallback={
              <div class="rounded-lg border border-border-weak-base bg-surface-panel p-3 text-12-regular text-text-weak">
                正在加载原型图...
              </div>
            }
          >
            <Show
              when={(items() ?? []).length > 0}
              fallback={
                <div class="rounded-lg border border-border-weak-base bg-surface-panel p-3 text-12-regular text-text-weak">
                  当前会话没有原型图
                </div>
              }
            >
              <div class="grid gap-3">
                <For each={items() ?? []}>
                  {(item) => (
                    <article class="overflow-hidden rounded-lg border border-border-weak-base bg-surface-panel">
                      <div class="border-b border-border-weak-base px-3 py-3">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                              <div class="truncate text-13-medium text-text-strong">{item.title}</div>
                              <Show when={item.is_latest}>
                                <div class="rounded-full bg-success-base/15 px-2 py-0.5 text-11-medium text-success-base">
                                  最新版本
                                </div>
                              </Show>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weak">
                              <div>版本：v{item.version}</div>
                              <div>页面路由：{item.route || "-"}</div>
                              <div>页面编码：{item.page_key}</div>
                            </div>
                            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weak">
                              <div>来源：{item.source_type === "manual_upload" ? "上传图片" : "截图保存"}</div>
                              <div>时间：{formatTime(item.time_created)}</div>
                            </div>
                            <Show when={item.storage_key}>
                              <div class="mt-2 break-all text-11-regular text-text-weak">保存路径：{item.storage_key}</div>
                            </Show>
                          </div>

                          <div class="flex shrink-0 gap-2">
                            <a
                              href={image(item, "original")}
                              target="_blank"
                              rel="noreferrer"
                              class="inline-flex items-center rounded-md border border-border-weak-base bg-background px-3 py-1.5 text-12-medium text-text-strong transition-colors hover:bg-surface-panel"
                            >
                              查看原图
                            </a>
                            <Show when={isBuild()}>
                              <button
                                type="button"
                                class="inline-flex items-center rounded-md border border-[#fca5a5] bg-[#fef2f2] px-3 py-1.5 text-12-medium text-[#b91c1c] transition-colors hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={removing() === item.id}
                                onClick={() => remove(item)}
                              >
                                {removing() === item.id ? "删除中..." : "删除图片"}
                              </button>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="bg-background p-3">
                        <a href={image(item, "original")} target="_blank" rel="noreferrer" class="block">
                          <img
                            src={image(item, "thumbnail")}
                            alt={item.title}
                            class="max-h-96 w-full rounded-md border border-border-weak-base object-contain bg-surface-panel"
                          />
                        </a>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </div>
  )
}
