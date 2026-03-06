import { createMemo, For, Match, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useAccountAuth } from "@/context/account-auth"
import { useAccountProject } from "@/context/account-project"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectAssignedProject } from "@/components/dialog-select-assigned-project"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

export default function Home() {
  const auth = useAccountAuth()
  const accountProject = useAccountProject()
  const sync = useGlobalSync()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  async function openProject(directory: string) {
    const project = sync.data.project.find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
    if (!project?.id) return
    const activated = await accountProject.activate(project.id, true)
    if (!activated.ok) return
    const last = activated.state.last_session_by_project[project.id]
    navigate(last ? `/${base64Encode(last.directory)}/session/${last.session_id}` : `/${base64Encode(project.worktree)}/session`)
  }

  async function chooseProject() {
    const payload = await auth.contextProducts()
    const projects = payload?.products ?? []
    if (projects.length === 0) return
    const productID = await new Promise<string | null>((resolve) => {
      dialog.show(
        () => <DialogSelectAssignedProject projects={projects} onSelect={resolve} />,
        () => resolve(null),
      )
    })
    if (!productID) return
    const target = projects.find((item) => item.id === productID)
    if (!target?.worktree) return
    const activated = await accountProject.activate(target.project_id, true)
    if (!activated.ok) return
    const last = activated.state.last_session_by_project[target.project_id]
    navigate(last ? `/${base64Encode(last.directory)}/session/${last.session_id}` : `/${base64Encode(target.worktree)}/session`)
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => void openProject(project.worktree)}
                  >
                    {project.worktree.replace(homedir(), "~")}
                    <div class="text-14-regular text-text-weak">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
            </div>
            <Button class="px-3 mt-1" onClick={() => void chooseProject()}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
