import type { Project } from "@opencode-ai/sdk/v2/client"

type ProjectRef = Pick<Project, "worktree" | "sandboxes"> & { id?: string }

export function directoryKey(input: string) {
  const drive = input.match(/^([A-Za-z]:)[\\/]+$/)
  if (drive) return `${drive[1]}${input.includes("\\") ? "\\" : "/"}`
  if (/^[\\/]+$/.test(input)) return input.includes("\\") ? "\\" : "/"
  return input.replace(/[\\/]+$/, "")
}

export function projectDirectories(project: ProjectRef) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

function derivedProjectID(directory: string) {
  const match = directory.replace(/\\/g, "/").match(/(?:^|\/)(?:batch-)?worktree\/([^/]+)(?:\/|$)/i)
  return match?.[1]?.toLowerCase()
}

export function resolveProjectByDirectory<T extends ProjectRef>(projects: readonly T[], directory: string) {
  const key = directoryKey(directory)
  const exact = projects.find((project) => projectDirectories(project).some((item) => directoryKey(item) === key))
  if (exact) return exact
  const inferred = derivedProjectID(directory)
  if (!inferred) return
  return projects.find((project) => project.id?.toLowerCase() === inferred)
}

export function projectRootByDirectory<T extends ProjectRef>(projects: readonly T[], directory: string) {
  return resolveProjectByDirectory(projects, directory)?.worktree ?? directory
}

export function sanitizeProjectWorkspaceOrder(project: ProjectRef, order?: string[]) {
  const all = projectDirectories(project)
  if (!order || order.length === 0) return all
  const keep = [...new Set(order.filter((directory) => all.some((item) => directoryKey(item) === directoryKey(directory))))]
  const root = project.worktree
  const next = [root, ...keep.filter((directory) => directoryKey(directory) !== directoryKey(root))]
  const missing = all.filter((directory) => !next.some((item) => directoryKey(item) === directoryKey(directory)))
  return [...next, ...missing]
}
