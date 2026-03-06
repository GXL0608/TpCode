import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { VoiceAttachmentPart } from "@/context/prompt"

type PromptVoiceAttachmentsProps = {
  attachments: VoiceAttachmentPart[]
  onRemove: (id: string) => void
  removeLabel: string
}

const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"

export const PromptVoiceAttachments: Component<PromptVoiceAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-col gap-2 px-3 pt-2">
        <For each={props.attachments}>
          {(attachment) => (
            <div class="relative group rounded-md border border-border-base bg-surface-base px-2 py-1.5">
              <div class="flex items-center gap-1.5 mb-1 pr-6">
                <Icon name="speech-bubble" class="size-3.5 text-text-weak" />
                <span class="text-11-medium truncate text-text-base">{attachment.filename}</span>
                <span class="text-10-regular text-text-weak shrink-0">{Math.max(1, Math.round(attachment.duration_ms / 1000))}s</span>
              </div>
              <audio controls preload="metadata" src={attachment.dataUrl} class="w-full h-8" />
              <button
                type="button"
                onClick={() => props.onRemove(attachment.id)}
                class={removeClass}
                aria-label={props.removeLabel}
              >
                <Icon name="close" class="size-3 text-text-weak" />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
