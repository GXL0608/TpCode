import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { resolveProjectByDirectory } from "@/context/project-resolver"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"

const ROOT_CLASS =
  "size-full flex flex-col justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto 2xl:max-w-[1000px] px-6 pb-16"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
  planPreview?: string
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const project = createMemo(() => resolveProjectByDirectory(globalSync.data.project, sync.directory))

  return (
    <div class={ROOT_CLASS}>
      <div class="text-20-medium text-text-weaker">{language.t("command.session.new")}</div>
      <Show when={project()}>
        {(item) => (
          <div class="flex justify-center items-center gap-3">
            <Icon name="pencil-line" size="small" />
            <div class="text-12-medium text-text-weak">
              {language.t("session.new.lastModified")}&nbsp;
              <span class="text-text-strong">
                {DateTime.fromMillis(item().time.updated ?? item().time.created)
                  .setLocale(language.locale())
                  .toRelative()}
              </span>
            </div>
          </div>
        )}
      </Show>
      <Show when={props.planPreview?.trim()}>
        {(text) => (
          <div class="w-full rounded-2xl border border-border-weak-base bg-surface-panel px-4 py-4">
            <div class="text-12-medium text-text-weak">已回填计划</div>
            <div class="mt-3 text-13-regular text-text-strong">
              <Markdown text={text()} />
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
