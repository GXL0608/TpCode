import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { resolveProjectByDirectory } from "@/context/project-resolver"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { newSessionWorkspaceState } from "./session-new-workspace"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS =
  "size-full flex flex-col justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto 2xl:max-w-[1000px] px-6 pb-16"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const project = createMemo(() => resolveProjectByDirectory(globalSync.data.project, sdk.directory))

  const sandboxes = createMemo(() => project()?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => project()?.worktree ?? sdk.directory)
  const isWorktree = createMemo(() => {
    const current = project()
    if (!current) return false
    return sdk.directory !== current.worktree
  })
  const workspace = createMemo(() =>
    newSessionWorkspaceState({
      directory: sdk.directory,
      projectRoot: projectRoot(),
      agent: local.agent.current()?.name,
    }),
  )

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div class={ROOT_CLASS}>
      <div class="text-20-medium text-text-weaker">{language.t("command.session.new")}</div>
      <div class="w-full rounded-lg border border-border-weak-base bg-background-base/60 px-4 py-3">
        <div class="text-11-medium uppercase tracking-[0.08em] text-text-weaker">
          {language.t("session.new.workspace.label")}
        </div>
        <div class="mt-2 text-14-medium text-text-strong">{language.t(workspace().label)}</div>
        <div class="mt-2 text-12-medium text-text-weak select-text break-all">
          {language.t("session.new.workspace.path")}&nbsp;
          <span class="text-text-strong">{sdk.directory}</span>
        </div>
        <Show when={workspace().buildHint}>
          {(hint) => <div class="mt-2 text-12-medium text-status-warning">{language.t(hint())}</div>}
        </Show>
      </div>
      <div class="flex justify-center items-center gap-3">
        <Icon name="folder" size="small" />
        <div class="text-12-medium text-text-weak select-text">
          {getDirectory(projectRoot())}
          <span class="text-text-strong">{getFilename(projectRoot())}</span>
        </div>
      </div>
      <div class="flex justify-center items-center gap-1">
        <Icon name="branch" size="small" />
        <div class="text-12-medium text-text-weak select-text ml-2">{label(current())}</div>
      </div>
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
    </div>
  )
}
