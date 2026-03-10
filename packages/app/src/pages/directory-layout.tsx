import { createEffect, createMemo, createSignal, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useAccountAuth } from "@/context/account-auth"
import { useAccountProject } from "@/context/account-project"

import { DataProvider } from "@opencode-ai/ui/context"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const auth = useAccountAuth()
  const accountProject = useAccountProject()
  const language = useLanguage()

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
      onSavePlan={async (input) => {
        const result = await auth.savePlan({
          session_id: input.sessionID,
          message_id: input.messageID,
          part_id: input.partID,
          project_id: accountProject.current()?.id ?? sync.project?.id ?? auth.user()?.context_project_id,
          vho_feedback_no: input.vho_feedback_no,
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
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({ invalid: "" })
  const [last, setLast] = createSignal("")
  const decoded = createMemo(() => decode64(params.dir))
  const directory = createMemo(() => decoded() ?? last())

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
  return (
    <Show when={directory()}>
      <SDKProvider directory={directory}>
        <SyncProvider>
          <DirectoryDataProvider directory={directory()}>{props.children}</DirectoryDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
