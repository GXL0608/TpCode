import { createEffect, createMemo, createSignal, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useAccountAuth } from "@/context/account-auth"
import { useAccountProject } from "@/context/account-project"
import { useGlobalSync } from "@/context/global-sync"
import { DialogPlanFeedback } from "@/components/dialog-plan-feedback"
import { buildPlanFeedbackUrl, getPlanFeedbackPhoneIssue } from "@/components/plan-feedback"

import { DataProvider } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { resolveProjectByDirectory } from "@/context/project-resolver"

/**
 * 为目录级上下文注入会话保存计划后的前端行为。
 */
function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const auth = useAccountAuth()
  const accountProject = useAccountProject()
  const language = useLanguage()
  const dialog = useDialog()
  const [planPhone, setPlanPhone] = createSignal("")

  /**
   * 读取并校验计划保存/反馈所需的手机号。
   */
  const ensurePlanPhone = async (mode: "save" | "feedback") => {
    const info = await auth.meVho()
    if (!info) {
      return {
        ok: false as const,
        code: "plan_phone_fetch_failed",
        message: language.t("plan.feedback.toast.phoneFetchFailed"),
      }
    }

    const issue = getPlanFeedbackPhoneIssue({
      phone: info.phone,
      mode,
    })
    if (issue) {
      return {
        ok: false as const,
        code: mode === "save" ? "plan_phone_required" : "plan_feedback_phone_required",
        message: language.t(issue),
      }
    }

    const phone = info.phone?.trim()
    if (!phone) {
      return {
        ok: false as const,
        code: "plan_phone_required",
        message: language.t("plan.feedback.toast.phoneRequiredToSave"),
      }
    }

    setPlanPhone(phone)
    return {
      ok: true as const,
      phone,
    }
  }

  /**
   * 在计划保存成功后，拉取手机号并打开第三方反馈弹窗。
   */
  const openPlanFeedback = async (input: {
    id: string
  }) => {
    const loaded = planPhone().trim()
      ? { ok: true as const, phone: planPhone().trim() }
      : await ensurePlanPhone("feedback")
    if (!loaded.ok) {
      showToast({
        variant: loaded.code === "plan_phone_fetch_failed" ? "error" : "default",
        title: loaded.code === "plan_phone_fetch_failed" ? language.t("common.requestFailed") : language.t("plan.feedback.toast.savedTitle"),
        description: loaded.message,
      })
      return
    }
    const url = buildPlanFeedbackUrl({
      phone: loaded.phone,
      plan_id: input.id,
    })
    dialog.show(() => <DialogPlanFeedback url={url} />)
  }

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
      onSavePlan={async (input) => {
        const phone = await ensurePlanPhone("save")
        if (!phone.ok) {
          showToast({
            variant: phone.code === "plan_phone_fetch_failed" ? "error" : "default",
            title: phone.code === "plan_phone_fetch_failed" ? language.t("common.requestFailed") : language.t("ui.messagePart.plan.save"),
            description: phone.message,
          })
          return {
            ok: false as const,
            code: phone.code,
            message: phone.message,
          }
        }
        const result = await auth.savePlan({
          session_id: input.sessionID,
          message_id: input.messageID,
          part_id: input.partID,
          project_id: accountProject.current()?.id ?? sync.project?.id ?? auth.user()?.context_project_id,
        })
        if (!result.ok) {
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: result.message ?? result.code,
          })
        }
        if (result.ok) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("ui.messagePart.plan.saved"),
          })
        }
        return result
      }}
      onAfterSavePlan={(input) => void openPlanFeedback({ id: input.id })}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const auth = useAccountAuth()
  const accountProject = useAccountProject()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [store, setStore] = createStore({ invalid: "", aligning: "" })
  const [last, setLast] = createSignal("")
  const decoded = createMemo(() => decode64(params.dir))
  const directory = createMemo(() => decoded() ?? last())
  const target = createMemo(() => {
    if (!globalSync.data.ready) return
    const value = directory()
    if (!value) return
    return resolveProjectByDirectory(globalSync.data.project, value)
  })
  const contextReady = createMemo(() => {
    if (!directory()) return false
    if (!auth.enabled() || !auth.authenticated()) return true
    if (!globalSync.data.ready) return false
    const project = target()
    if (!project?.id) return true
    const current = accountProject.current()?.id ?? auth.user()?.context_project_id
    if (current !== project.id) return false
    return store.aligning !== project.id
  })

  createEffect(() => {
    const next = decoded()
    if (!next) return
    setLast(next)
  })

  createEffect(() => {
    if (!params.dir) return
    if (decoded()) return
    if (store.invalid === params.dir) return
    setStore("invalid", params.dir)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  createEffect(() => {
    if (!auth.enabled() || !auth.authenticated()) return
    if (!globalSync.data.ready) return
    const project = target()
    if (!project?.id) return
    const current = accountProject.current()?.id ?? auth.user()?.context_project_id
    if (current === project.id) return
    if (store.aligning === project.id) return
    setStore("aligning", project.id)
    void accountProject
      .activate(project.id, true)
      .then((result) => {
        if (result.ok) return
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: language.t("directory.error.invalidUrl"),
        })
        navigate("/", { replace: true })
      })
      .finally(() => {
        setStore("aligning", (value) => (value === project.id ? "" : value))
      })
  })

  return (
    <Show when={contextReady()}>
      <SDKProvider directory={directory}>
        <SyncProvider>
          <DirectoryDataProvider directory={directory()}>{props.children}</DirectoryDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
