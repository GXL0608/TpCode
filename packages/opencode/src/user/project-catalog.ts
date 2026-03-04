import { Flag } from "@/flag/flag"
import { Project } from "@/project/project"
import { ProjectTable } from "@/project/project.sql"
import { Database } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { work } from "@/util/queue"
import { createHash } from "crypto"
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

function key(input: string) {
  return Filesystem.windowsPath(path.resolve(input)).toLowerCase()
}

function folderID(input: string) {
  const digest = createHash("sha1").update(key(input)).digest("hex").slice(0, 24)
  return `folder_${digest}`
}

function folderProject(input: string) {
  const worktree = path.resolve(input)
  const id = folderID(worktree)
  const now = Date.now()
  const name = path.basename(worktree) || undefined
  return {
    id,
    worktree,
    name,
    sandboxes: [],
    time: {
      created: now,
      updated: now,
    },
  }
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
  if (dirs.length === 0) return [] as Awaited<ReturnType<typeof Project.list>>
  const known = await Project.list()
  const worktree = new Map(known.map((item) => [key(item.worktree), item]))
  const results = [] as Awaited<ReturnType<typeof Project.list>>
  const inserts = [] as {
    id: string
    worktree: string
    vcs: string | null
    name?: string
    sandboxes: string[]
  }[]
  const seen = new Set<string>()
  const add = (item: (typeof known)[number]) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    results.push(item)
  }
  const unknown = [] as string[]
  for (const dir of dirs) {
    const hit = worktree.get(key(dir))
    if (hit) {
      add(hit)
      continue
    }
    unknown.push(path.resolve(dir))
  }
  const checks = await Promise.all(
    unknown.map(async (dir) => ({
      dir,
      git: await Filesystem.exists(path.join(dir, ".git")),
    })),
  )
  for (const item of checks) {
    if (item.git) continue
    const project = folderProject(item.dir)
    add(project)
    inserts.push({
      id: project.id,
      worktree: project.worktree,
      vcs: null,
      name: project.name,
      sandboxes: [],
    })
  }
  const tasks = checks.filter((item) => item.git).map((item) => ({
    dir: item.dir,
    project: undefined as Awaited<ReturnType<typeof Project.fromDirectory>>["project"] | undefined,
  }))
  await work(6, tasks, async (item) => {
    item.project = await Project.fromDirectory(item.dir)
      .then((result) => result.project)
      .catch(() => undefined)
  })
  for (const item of tasks) {
    if (item.project && item.project.id !== "global") {
      add(item.project)
      continue
    }
    const project = folderProject(item.dir)
    add(project)
    inserts.push({
      id: project.id,
      worktree: project.worktree,
      vcs: null,
      name: project.name,
      sandboxes: [],
    })
  }
  if (inserts.length > 0) {
    const rows = [...new Map(inserts.map((item) => [item.id, item])).values()]
    await Database.use((db) => db.insert(ProjectTable).values(rows).onConflictDoNothing().run())
  }
  return results.filter((item): item is NonNullable<typeof item> => !!item)
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
