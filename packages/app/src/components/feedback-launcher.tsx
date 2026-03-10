import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, createMemo, type Component } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { feedbackCanOpen } from "./feedback-helpers"
import { DialogFeedbackForum } from "./dialog-feedback-forum"

export const FeedbackLauncher: Component = () => {
  const auth = useAccountAuth()
  const dialog = useDialog()

  const visible = createMemo(() =>
    feedbackCanOpen({
      enabled: auth.enabled(),
      authenticated: auth.authenticated(),
      feedback_enabled: auth.user()?.feedback_enabled,
      context_project_id: auth.user()?.context_project_id,
      permissions: auth.user()?.permissions ?? [],
    }),
  )

  return (
    <Show when={visible()}>
      <div
        class="fixed right-4 md:right-6 z-30"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        }}
      >
        <Button
          size="large"
          icon="bubble-5"
          class="rounded-full border border-border-weak-base bg-surface-raised text-text-strong shadow-lg hover:bg-surface-panel px-4"
          onClick={() => dialog.show(() => <DialogFeedbackForum />)}
        >
          反馈
        </Button>
      </div>
    </Show>
  )
}
