/** 统一维护新增用户弹窗的布局样式常量。 */
export function createUserLayout() {
  return {
    dialog:
      "w-full max-w-lg max-h-[90vh] rounded-xl border border-border-weak-base bg-background-base shadow-lg flex flex-col",
    body: "min-h-0 overflow-y-auto p-5 flex flex-col gap-3",
    roleTrigger:
      "w-full min-h-12 rounded-md border border-border-weak-base bg-surface-panel px-3 py-2 flex items-center justify-between gap-3 text-left",
    rolePanel:
      "w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border-weak-base bg-background-base shadow-lg overflow-hidden p-0",
    roleSearch: "border-b border-border-weak-base bg-surface-panel px-3 py-3 flex flex-col gap-2",
    roleList: "max-h-[min(40vh,320px)] overflow-auto p-2 flex flex-col gap-1",
    roleItem:
      "w-full flex items-center justify-between gap-3 rounded-md border border-transparent bg-transparent px-3 py-2 text-left hover:bg-surface-panel",
    roleFooter: "border-t border-border-weak-base bg-surface-panel/60 px-3 py-2 flex items-center justify-between gap-3",
    footer: "px-5 pb-5 flex justify-end gap-2",
  }
}
