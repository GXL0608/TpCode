import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { For, createMemo, createSignal } from "solid-js"

type Item = {
  id: string
  name?: string
  worktree: string
  selected?: boolean
  last_selected?: boolean
}

export function DialogSelectAssignedProject(props: {
  projects: Item[]
  onSelect: (projectID: string | null) => void
}) {
  const first = createMemo(() => props.projects.find((item) => item.last_selected)?.id ?? props.projects[0]?.id ?? "")
  const [selected, setSelected] = createSignal(first())

  return (
    <Dialog size="normal" class="w-[680px] max-w-[95vw]">
      <div class="flex flex-col gap-3 p-4">
        <div>
          <div class="text-16-medium text-text-strong">选择项目</div>
          <div class="text-12-regular text-text-weak mt-1">仅展示你已分配的项目</div>
        </div>
        <div class="max-h-96 overflow-auto pr-1 flex flex-col gap-2">
          <For each={props.projects}>
            {(item) => (
              <button
                type="button"
                class="w-full rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-left"
                onClick={() => setSelected(item.id)}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="text-14-medium text-text-strong">{item.name || item.worktree}</div>
                  <div class="text-12-regular text-text-weak">{selected() === item.id ? "已选择" : ""}</div>
                </div>
                <div class="text-12-regular text-text-weak mt-1 break-all">{item.worktree}</div>
              </button>
            )}
          </For>
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => props.onSelect(null)}>
            取消
          </Button>
          <Button type="button" disabled={!selected()} onClick={() => props.onSelect(selected())}>
            进入项目
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
