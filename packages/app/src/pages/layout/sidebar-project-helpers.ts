export const projectSelected = (currentDir: string, worktree: string, sandboxes?: string[]) =>
  worktree === currentDir || sandboxes?.includes(currentDir) === true

/** 中文注释：点击当前已选项目时显式返回侧栏动作，避免 toggle 在悬浮态下出现“关不掉”的错觉。 */
export const selectedProjectSidebarAction = (opened: boolean) => (opened ? "close" : "open")

export const projectTileActive = (args: {
  menu: boolean
  preview: boolean
  open: boolean
  overlay: boolean
  hoverProject?: string
  worktree: string
}) => args.menu || (args.preview ? args.open : args.overlay && args.hoverProject === args.worktree)
