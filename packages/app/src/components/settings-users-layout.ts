export function createUserLayout() {
  return {
    dialog:
      "w-full max-w-lg max-h-[90vh] rounded-xl border border-border-weak-base bg-background-base shadow-lg flex flex-col",
    body: "min-h-0 overflow-y-auto p-5 flex flex-col gap-3",
    rolePanel: "rounded-md border border-border-weak-base bg-surface-panel p-3 max-h-64 overflow-auto",
    roleList: "flex flex-col gap-2",
    roleItem:
      "flex items-center gap-2 rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular",
    footer: "px-5 pb-5 flex justify-end gap-2",
  }
}
