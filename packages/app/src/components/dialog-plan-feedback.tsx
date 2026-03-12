import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { createMediaQuery } from "@solid-primitives/media"
import type { Component } from "solid-js"

type Props = {
  url: string
}

/**
 * 展示第三方计划反馈页面，并提供外部打开兜底入口。
 */
export const DialogPlanFeedback: Component<Props> = (props) => {
  const platform = usePlatform()
  const language = useLanguage()
  const mobile = createMediaQuery("(max-width: 767px)")

  return (
    <Dialog
      title={language.t("plan.feedback.dialog.title")}
      size="xx-large"
      class={mobile() ? "min-h-[calc(100dvh-32px)]" : undefined}
      description={language.t("plan.feedback.dialog.description")}
    >
      <div class="flex h-full min-h-0 flex-col gap-3 px-4 pb-4">
        <div class="flex items-center justify-end">
          <Button type="button" variant="secondary" size="large" onClick={() => platform.openLink(props.url)}>
            {language.t("plan.feedback.dialog.openExternal")}
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-base bg-white shadow-sm">
          <iframe
            src={props.url}
            title={language.t("plan.feedback.dialog.frameTitle")}
            class="h-full min-h-[60dvh] w-full border-0"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </Dialog>
  )
}
