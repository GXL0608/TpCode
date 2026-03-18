import { For, Show, createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"
import { buildSummaryLine } from "../build-job-summary"
import { buildStageGroups, buildStageLabel } from "../settings-build-center-detail"

type SessionBuildStatusProps = {
  sessionID?: string
}

export const SESSION_BUILD_STATUS_CARD_CLASS =
  "mx-3 mt-3 min-w-0 shrink-0 overflow-hidden rounded-xl border p-4 md:mx-5"
export const SESSION_BUILD_STATUS_LAYOUT_CLASS =
  "flex min-w-0 max-h-[min(42vh,420px)] flex-col gap-3 overflow-hidden"
export const SESSION_BUILD_STATUS_SCROLL_CLASS = "min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-1"
export const SESSION_BUILD_STATUS_META_CLASS = "grid min-w-0 gap-3 md:grid-cols-4"

type StageLike = {
  stage?: string
  status?: string
  detail_json?: Record<string, unknown>
  error_message?: string
}

/** 中文注释：把 build job 状态翻译成会话页可读标题，方便用户快速判断当前闭环进展。 */
function buildStatusText(input?: string) {
  if (input === "pending") return "构建任务已提交"
  if (input === "running") return "构建任务执行中"
  if (input === "completed") return "构建任务已完成"
  if (input === "failed") return "构建任务执行失败"
  return "构建任务状态"
}

/** 中文注释：根据 build job 状态切换提示色，让失败和进行中更容易被用户感知。 */
function buildStatusClass(input?: string) {
  if (input === "failed") return "border-icon-critical-base/30 bg-icon-critical-base/8"
  if (input === "completed") return "border-icon-success-base/25 bg-icon-success-base/8"
  return "border-border-weak-base bg-surface-panel/45"
}

/** 中文注释：生成带鉴权 token 的构建产物下载地址，保证会话页可直接下载 zip 包。 */
function artifactURL(base: string | undefined, artifact_id: string) {
  const token = AccountToken.access()
  if (!base || !token) return ""
  const url = new URL(`/build/artifact/${encodeURIComponent(artifact_id)}/file`, base)
  url.searchParams.set("access_token", token)
  return url.toString()
}

/** 中文注释：把最近一次 handoff 更新时间转成用户可读文案，避免用户不知道前端是不是还在持续轮询。 */
export function buildRefreshText(at?: number, now = Date.now()) {
  if (!at) return "等待状态刷新"
  const delta = Math.max(0, now - at)
  if (delta < 5_000) return "刚刚刷新"
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前刷新`
  return `${Math.floor(delta / 60_000)} 分钟前刷新`
}

/** 中文注释：从当前阶段详情里抽取最关键的运行提示，让会话页在不展开明细时也能看出后台正在做什么。 */
export function buildLiveHeadline(stage?: StageLike) {
  const detail = stage?.detail_json
  if (!detail) return "后台正在准备构建详情..."
  if (typeof detail.current_status === "string" && detail.current_status.trim()) return detail.current_status.trim()
  if (typeof detail.current_step === "string" && detail.current_step.trim()) return `当前步骤：${detail.current_step.trim()}`
  const active = detail.active
  if (active && typeof active === "object") {
    const row = active as Record<string, unknown>
    if (typeof row.current_status === "string" && row.current_status.trim()) return row.current_status.trim()
    if (typeof row.current_step === "string" && row.current_step.trim()) return `当前步骤：${row.current_step.trim()}`
  }
  const recent = Array.isArray(detail.recent_activity)
    ? detail.recent_activity.find((item) => item && typeof item === "object")
    : undefined
  if (recent && typeof (recent as Record<string, unknown>).summary === "string") {
    const summary = ((recent as Record<string, unknown>).summary as string).trim()
    if (summary) return summary
  }
  return "后台正在准备构建详情..."
}

/** 中文注释：在会话页直接展示当前会话最近一次 build 的阶段状态与产物，减少用户来回切构建中心。 */
export function SessionBuildStatus(props: SessionBuildStatusProps) {
  const layout = useLayout()
  const server = useServer()
  const detail = createMemo(() => (props.sessionID ? layout.handoff.buildJob(props.sessionID) : undefined))
  const currentStage = createMemo(() => {
    const current = detail()
    if (!current) return
    return current.stages.find((item) => item.stage === current.current_stage) ?? current.stages.at(-1)
  })
  const stageSummary = createMemo(() =>
    (detail()?.stages ?? []).map((item) => `${buildStageLabel(item.stage ?? "-")}:${item.status ?? "-"}`).join(" / "),
  )
  const liveHeadline = createMemo(() => buildLiveHeadline(currentStage()))
  const refreshText = createMemo(() => buildRefreshText(detail()?.at))

  return (
    <Show when={detail()}>
      {(item) => (
        <div class={`${SESSION_BUILD_STATUS_CARD_CLASS} ${buildStatusClass(item().status)}`}>
          <div class={SESSION_BUILD_STATUS_LAYOUT_CLASS}>
            <div class="shrink-0 min-w-0 flex flex-col gap-3">
              <div class="flex min-w-0 flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                  <div class="text-13-medium text-text-strong">{buildStatusText(item().status)}</div>
                  <div class="mt-1 text-11-regular text-text-weak">
                    {buildSummaryLine({
                      solution_scope: item().solution_scope,
                      stages: item().stages,
                      artifacts: item().artifacts,
                    })}
                  </div>
                </div>
                <div class="min-w-0 text-11-regular text-text-weak break-all">任务 {item().job_id}</div>
              </div>

              <div class={SESSION_BUILD_STATUS_META_CLASS}>
                <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3">
                  <div class="text-11-medium text-text-weak">当前阶段</div>
                  <div class="mt-2 text-12-regular text-text-strong">
                    {buildStageLabel(item().current_stage ?? "-")}
                  </div>
                </div>
                <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3">
                  <div class="text-11-medium text-text-weak">最近刷新</div>
                  <div class="mt-2 text-12-regular text-text-strong">{refreshText()}</div>
                </div>
                <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3 md:col-span-2">
                  <div class="text-11-medium text-text-weak">当前动态</div>
                  <div class="mt-2 text-12-regular text-text-strong whitespace-pre-wrap break-all">
                    {liveHeadline()}
                  </div>
                </div>
                <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3 md:col-span-4">
                  <div class="text-11-medium text-text-weak">阶段进度</div>
                  <div class="mt-2 text-12-regular text-text-strong whitespace-pre-wrap break-all">
                    {stageSummary() || "后台正在准备构建详情..."}
                  </div>
                </div>
              </div>
            </div>

            <div class={SESSION_BUILD_STATUS_SCROLL_CLASS}>
              <div class="flex min-w-0 flex-col gap-3">
                <Show when={item().error_message}>
                  <div class="rounded-lg bg-icon-critical-base/10 px-3 py-3 text-12-regular text-icon-critical-base break-all">
                    {item().error_message}
                  </div>
                </Show>

                <Show when={currentStage()}>
                  {(stage) => (
                    <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3">
                      <div class="flex min-w-0 items-center justify-between gap-3">
                        <div class="min-w-0 text-12-medium text-text-strong">{buildStageLabel(stage().stage ?? "-")}</div>
                        <div class="shrink-0 text-11-regular text-text-weak">{stage().status ?? "-"}</div>
                      </div>
                      <Show when={stage().error_message}>
                        <div class="mt-3 rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base break-all">
                          {stage().error_message}
                        </div>
                      </Show>
                      <Show when={buildStageGroups(stage()).length > 0}>
                        <div class="mt-3 flex min-w-0 flex-col gap-3">
                          <For each={buildStageGroups(stage())}>
                            {(group) => (
                              <div class="min-w-0 rounded-lg bg-surface-panel/45 px-3 py-3">
                                <div class="text-12-medium text-text-strong">{group.name}</div>
                                <div class="mt-2 flex min-w-0 flex-col gap-1">
                                  <For each={group.lines}>
                                    {(line) => <div class="text-11-regular text-text-weak break-all">{line}</div>}
                                  </For>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={item().artifacts.length > 0}>
                  <div class="min-w-0 rounded-lg bg-surface-base px-3 py-3">
                    <div class="text-12-medium text-text-strong">当前产物</div>
                    <div class="mt-2 flex min-w-0 flex-col gap-2">
                      <For each={item().artifacts}>
                        {(artifact) => (
                          <a
                            class="text-icon-info-active underline break-all"
                            href={artifactURL(server.current?.http.url, artifact.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {artifact.file_name}
                          </a>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
