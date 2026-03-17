import { For, Show, type Accessor, type JSX } from "solid-js"
import { base64Encode } from "@opencode-ai/util/encode"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { SessionItem, type SessionItemProps } from "./sidebar-items"
import { productSidebarAvatar, productSidebarItemClass, productSidebarName } from "./sidebar-product-view-helpers"

type ProductLike = {
  id: string
  name?: string
  project_id?: string
  related_project_ids?: string[]
}

export type ProductSidebarSession = {
  session: Session
  children: Map<string, string[]>
}

/** 中文注释：产品侧栏单独渲染产品导航，用户只看到产品，不再看到解决方案项目。 */
export function SidebarProductContent(props: {
  mobile?: boolean
  products: Accessor<readonly ProductLike[]>
  current_product_id: Accessor<string | undefined>
  onSelectProduct: (product: ProductLike) => void
  onOpenProductPicker: () => void
  openProductLabel: Accessor<string>
  openProductKeybind: Accessor<string | undefined>
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  renderPanel: () => JSX.Element
}) {
  const placement = () => (props.mobile ? "bottom" : "right")
  return (
    <div class="flex h-full w-full overflow-hidden">
      <div class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden">
        <div class="flex-1 min-h-0 w-full">
          <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
            <For each={props.products()}>
              {(product) => (
                <Tooltip placement={placement()} value={productSidebarName(product)}>
                  <button
                    type="button"
                    aria-label={productSidebarName(product)}
                    class={productSidebarItemClass(product.id === props.current_product_id())}
                    onClick={() => props.onSelectProduct(product)}
                  >
                    <Avatar
                      fallback={productSidebarAvatar(product)}
                      background="var(--surface-info-base)"
                      foreground="var(--text-base)"
                      class="size-8 rounded"
                    />
                  </button>
                </Tooltip>
              )}
            </For>
            <TooltipKeybind
              placement={placement()}
              title={props.openProductLabel()}
              keybind={props.mobile ? "" : props.openProductKeybind() ?? ""}
            >
              <IconButton icon="plus" variant="ghost" size="large" onClick={props.onOpenProductPicker} />
            </TooltipKeybind>
          </div>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
            />
          </TooltipKeybind>
        </div>
      </div>
      {props.renderPanel()}
    </div>
  )
}

/** 中文注释：产品侧栏面板只展示产品名和当前产品的会话列表，不再展示解决方案路径。 */
export function SidebarProductPanel(props: {
  mobile?: boolean
  name: Accessor<string>
  sessions: Accessor<ProductSidebarSession[]>
  sessionProps: Omit<SessionItemProps, "session" | "slug" | "children" | "mobile" | "dense" | "popover">
  onCreateSession: () => void
  newSessionLabel: Accessor<string>
  newSessionKeybind: Accessor<string | undefined>
}) {
  return (
    <div
      classList={{
        "flex flex-col min-h-0 bg-background-stronger border border-b-0 border-border-weak-base rounded-tl-[12px]": true,
        "flex-1 min-w-0": props.mobile,
      }}
    >
      <div class="shrink-0 px-2 py-1">
        <div class="flex items-start justify-between gap-2 p-2 pr-1">
          <div class="flex flex-col min-w-0">
            <div class="text-14-medium text-text-strong truncate">{props.name()}</div>
          </div>
        </div>
      </div>
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="shrink-0 py-4 px-3">
          <TooltipKeybind title={props.newSessionLabel()} keybind={props.newSessionKeybind() ?? ""} placement="top">
            <Button size="large" icon="plus-small" class="w-full" onClick={props.onCreateSession}>
              {props.newSessionLabel()}
            </Button>
          </TooltipKeybind>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 pb-2">
          <div class="flex flex-col gap-1">
            <For each={props.sessions()}>
              {(item) => (
                <SessionItem
                  {...props.sessionProps}
                  session={item.session}
                  slug={base64Encode(item.session.directory)}
                  dense
                  mobile={props.mobile}
                  popover={false}
                  children={item.children}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
