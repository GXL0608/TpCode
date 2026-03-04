import { Flag } from "@/flag/flag"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"
import { readdir } from "fs/promises"
import path from "path"
import { AccountSystemSettingService } from "./system-setting"

type Source = "registered" | "scanned"

function sort(items: {
  id: string
  name?: string
  worktree: string
  vcs?: string
  sources: Source[]
}[]) {
  return items.sort((a, b) => {
    const left = a.name?.trim() || a.worktree
    const right = b.name?.trim() || b.worktree
    return left.localeCompare(right)
  })
}

async function scan() {
  const fromEnv = Flag.TPCODE_PROJECT_SCAN_ROOT?.trim()
  const fromSetting = fromEnv ? undefined : await AccountSystemSettingService.projectScanRoot()
  const roots = (fromEnv || fromSetting?.project_scan_root || path.resolve(process.cwd(), ".."))
    .split(/[,;\n]/g)
    .map((item: string) => item.trim())
    .filter((item: string): item is string => !!item)
  const rootEntries: string[][] = await Promise.all(
    roots.map(async (root: string) => {
      if (!(await Filesystem.isDir(root))) return [] as string[]
      const entries = await readdir(root, { withFileTypes: true }).catch(() => [] as Awaited<ReturnType<typeof readdir>>)
      return entries.filter((item) => item.isDirectory()).map((item) => path.join(root, item.name))
    }),
  )
  const dirs = [...new Set(rootEntries.flatMap((item: string[]) => item))]
  const results = await Promise.all(
    dirs.map(async (dir: string) => {
      return Project.fromDirectory(dir).then((item) => item.project).catch(() => undefined)
    }),
  )
  return results.filter((item): item is NonNullable<typeof item> => !!item && item.id !== "global")
}

export namespace AccountProjectCatalogService {
  export async function list(input?: { source?: "all" | Source }) {
    const source = input?.source ?? "all"
    const registered = source === "all" || source === "registered" ? await Project.list() : []
    const scanned = source === "all" || source === "scanned" ? await scan() : []
    const map = new Map<string, { id: string; name?: string; worktree: string; vcs?: string; sources: Source[] }>()
    for (const item of registered) {
      map.set(item.id, {
        id: item.id,
        name: item.name,
        worktree: item.worktree,
        vcs: item.vcs,
        sources: ["registered"],
      })
    }
    for (const item of scanned) {
      const found = map.get(item.id)
      if (found) {
        if (!found.sources.includes("scanned")) found.sources.push("scanned")
        if (!found.name && item.name) found.name = item.name
        continue
      }
      map.set(item.id, {
        id: item.id,
        name: item.name,
        worktree: item.worktree,
        vcs: item.vcs,
        sources: ["scanned"],
      })
    }
    return sort([...map.values()])
  }
}
