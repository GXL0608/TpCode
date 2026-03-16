import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Database, eq } from "@/storage/db"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { SessionTable } from "@/session/session.sql"
import { Glob } from "@/util/glob"
import { Filesystem } from "@/util/filesystem"

export namespace BuildOverlay {
  export const Mount = z.object({
    solution_id: z.string(),
    solution_code: z.string(),
    mount_name: z.string(),
    source_directory: z.string(),
    overlay_directory: z.string(),
  })
  export type Mount = z.infer<typeof Mount>

  export const Change = z.object({
    solution_id: z.string(),
    solution_code: z.string(),
    mount_name: z.string(),
    relative_path: z.string(),
    display_path: z.string(),
    change_type: z.enum(["create", "update", "delete"]),
    source_file_path: z.string().optional(),
    overlay_file_path: z.string().optional(),
    size: z.number().optional(),
    hash: z.string().optional(),
  })
  export type Change = z.infer<typeof Change>

  export const Info = z.object({
    root: z.string(),
    manifest_path: z.string(),
    mounts: z.array(Mount),
  })
  export type Info = z.infer<typeof Info>

  const Manifest = z.object({
    version: z.literal(1),
    changes: z.array(Change),
  })

  /** 中文注释：把路径统一转成稳定的 POSIX 相对路径，方便 manifest、前端展示和跨平台处理。 */
  function relative(input: string) {
    return input.replaceAll("\\", "/").replace(/^\/+/, "")
  }

  /** 中文注释：按 mount 和相对路径生成唯一键，便于覆盖更新 manifest 条目。 */
  function key(input: { mount_name: string; relative_path: string }) {
    return `${input.mount_name}:${relative(input.relative_path)}`
  }

  /** 中文注释：按挂载名查找 overlay mount，供编译和 bash 临时沙盒回写复用。 */
  function mount(info: Info, mount_name: string) {
    return info.mounts.find((item) => item.mount_name === mount_name)
  }

  /** 中文注释：判断目标路径是否位于当前 overlay 根目录内。 */
  function inside(root: string, target: string) {
    const normalized = path.resolve(target)
    return Filesystem.contains(path.resolve(root), normalized)
  }

  /** 中文注释：根据 overlay 路径解析所属 mount 与对应的源码/覆盖层文件位置。 */
  function resolve(input: { overlay: Info; filePath: string }) {
    const target = path.resolve(input.filePath)
    if (!inside(input.overlay.root, target)) return
    const rel = relative(path.relative(input.overlay.root, target))
    if (!rel || rel === ".") return
    const parts = rel.split("/")
    const mount_name = parts[0]
    if (!mount_name) return
    const mount = input.overlay.mounts.find((item) => item.mount_name === mount_name)
    if (!mount) return
    const relative_path = relative(parts.slice(1).join("/"))
    return {
      mount,
      mount_name,
      relative_path,
      display_path: relative_path ? `${mount_name}/${relative_path}` : mount_name,
      overlay_path: relative_path ? path.join(mount.overlay_directory, relative_path) : mount.overlay_directory,
      source_path: relative_path ? path.join(mount.source_directory, relative_path) : mount.source_directory,
    }
  }

  /** 中文注释：读取当前 overlay manifest；不存在时返回空清单。 */
  async function manifest(info: Info) {
    const text = await Bun.file(info.manifest_path).text().catch(() => "")
    if (!text.trim()) return { version: 1 as const, changes: [] as Change[] }
    const parsed = Manifest.safeParse(JSON.parse(text))
    if (parsed.success) return parsed.data
    return { version: 1 as const, changes: [] as Change[] }
  }

  /** 中文注释：把最新 manifest 原子写回磁盘，确保调试和重试都能复用。 */
  async function save(info: Info, changes: Change[]) {
    await fs.mkdir(path.dirname(info.manifest_path), { recursive: true })
    await Bun.write(
      info.manifest_path,
      JSON.stringify(
        {
          version: 1,
          changes,
        },
        null,
        2,
      ),
    )
  }

  /** 中文注释：根据当前源码或 overlay 文件内容生成稳定摘要，供阶段详情和后续比对复用。 */
  async function digest(filePath: string) {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return
    const buffer = Buffer.from(await file.arrayBuffer())
    return createHash("sha1").update(buffer).digest("hex")
  }

  /** 中文注释：把目录中的文件递归扫描成稳定相对路径集合，供 overlay 回写比对使用。 */
  async function files(directory: string) {
    return (await Glob.scan("**/*", { cwd: directory, absolute: false, include: "file", dot: true }).catch(() => []))
      .map(relative)
      .filter((item) => item !== ".git" && !item.startsWith(".git/"))
      .sort((a, b) => a.localeCompare(b))
  }

  /** 中文注释：从 manifest 中查找精确变更条目。 */
  async function findChange(info: Info, input: { mount_name: string; relative_path: string }) {
    return (await manifest(info)).changes.find((item) => key(item) === key(input))
  }

  /** 中文注释：用新的变更条目覆盖旧记录，保证每个逻辑文件只保留一条最新状态。 */
  async function upsertChange(info: Info, change: Change) {
    const current = await manifest(info)
    const next = current.changes.filter((item) => key(item) !== key(change))
    next.push(change)
    next.sort((a, b) => a.display_path.localeCompare(b.display_path))
    await save(info, next)
    return next
  }

  /** 中文注释：删除 manifest 中的单个变更条目。 */
  async function removeChange(info: Info, input: { mount_name: string; relative_path: string }) {
    const current = await manifest(info)
    const next = current.changes.filter((item) => key(item) !== key(input))
    await save(info, next)
    return next
  }

  /** 中文注释：扫描 overlay 根目录内实际存在的文件，并把它们回填成最新 manifest。 */
  export async function syncManifest(info: Info) {
    const current = await manifest(info)
    const keep = current.changes.filter((item) => item.change_type === "delete")
    const scanned = [] as Change[]

    for (const mount of info.mounts) {
      const files = await Glob.scan("**/*", {
        cwd: mount.overlay_directory,
        absolute: true,
        include: "file",
        dot: true,
      }).catch(() => [] as string[])
      for (const filePath of files) {
        const relative_path = relative(path.relative(mount.overlay_directory, filePath))
        if (!relative_path) continue
        const source_file_path = path.join(mount.source_directory, relative_path)
        const source_exists = await Bun.file(source_file_path).exists()
        scanned.push({
          solution_id: mount.solution_id,
          solution_code: mount.solution_code,
          mount_name: mount.mount_name,
          relative_path,
          display_path: `${mount.mount_name}/${relative_path}`,
          change_type: source_exists ? "update" : "create",
          source_file_path: source_exists ? source_file_path : undefined,
          overlay_file_path: filePath,
          size: await Filesystem.size(filePath),
          hash: await digest(filePath),
        })
      }
    }

    const keys = new Set(scanned.map((item) => key(item)))
    const next = [...scanned, ...keep.filter((item) => !keys.has(key(item)))]
    next.sort((a, b) => a.display_path.localeCompare(b.display_path))
    await save(info, next)
    return next
  }

  /** 中文注释：创建 overlay 根目录和 mount 空目录，并初始化 manifest。 */
  export async function create(input: {
    root: string
    manifest_path?: string
    mounts: Array<{
      solution_id: string
      solution_code: string
      mount_name: string
      source_directory: string
    }>
  }) {
    const info = Info.parse({
      root: path.resolve(input.root),
      manifest_path: path.resolve(input.manifest_path ?? path.join(input.root, ".tpcode-overlay-manifest.json")),
      mounts: input.mounts.map((item) => ({
        ...item,
        source_directory: path.resolve(item.source_directory),
        overlay_directory: path.resolve(path.join(input.root, item.mount_name)),
      })),
    })
    await fs.mkdir(info.root, { recursive: true })
    await Promise.all(info.mounts.map((item) => fs.mkdir(item.overlay_directory, { recursive: true })))
    await save(info, [])
    return info
  }

  /** 中文注释：从工作区 JSON 元数据恢复 overlay 信息，供工具层和 build 服务统一读取。 */
  export function fromWorkspace(workspace: { meta?: { overlay?: unknown } }) {
    return Info.safeParse(workspace.meta?.overlay).data
  }

  /** 中文注释：通过 session 读取当前 build 会话对应的 overlay 配置，没有 overlay 时返回 undefined。 */
  export async function load(sessionID: string) {
    const session = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    if (!session?.workspace_id) return
    const workspace = await Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, session.workspace_id!)).get())
    if (!workspace?.meta || typeof workspace.meta !== "object") return
    return Info.safeParse((workspace.meta as Record<string, unknown>).overlay).data
  }

  /** 中文注释：读取 overlay 合并视图中的文本文件，优先读 overlay，回退到源码文件。 */
  export async function readText(input: { overlay: Info; filePath: string }) {
    const resolved = resolve(input)
    if (!resolved) return await Bun.file(input.filePath).text()
    const removed = await findChange(input.overlay, resolved)
    if (removed?.change_type === "delete") {
      throw new Error(`File not found: ${input.filePath}`)
    }
    if (await Bun.file(resolved.overlay_path).exists()) return await Bun.file(resolved.overlay_path).text()
    if (await Bun.file(resolved.source_path).exists()) return await Bun.file(resolved.source_path).text()
    throw new Error(`File not found: ${input.filePath}`)
  }

  /** 中文注释：返回 overlay 合并视图中的路径状态，供 read/list/glob/grep 等工具复用。 */
  export async function stat(input: { overlay: Info; filePath: string }) {
    const resolved = resolve(input)
    if (!resolved) return Filesystem.stat(input.filePath)
    const removed = await findChange(input.overlay, resolved)
    if (removed?.change_type === "delete") return
    return Filesystem.stat(resolved.overlay_path) ?? Filesystem.stat(resolved.source_path) ?? Filesystem.stat(input.filePath)
  }

  /** 中文注释：把目录下的直接子项按 overlay 与源码合并，供 read/list 工具展示。 */
  export async function listDirectory(input: { overlay: Info; directory: string }) {
    const target = path.resolve(input.directory)
    if (target === path.resolve(input.overlay.root)) {
      return input.overlay.mounts.map((item) => `${item.mount_name}/`).sort((a, b) => a.localeCompare(b))
    }
    const resolved = resolve({ overlay: input.overlay, filePath: target })
    if (!resolved) {
      const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
      return entries
        .map((item) => (item.isDirectory() ? `${item.name}/` : item.name))
        .sort((a, b) => a.localeCompare(b))
    }

    const current = await manifest(input.overlay)
    const deleted = new Set(
      current.changes
        .filter((item) => item.change_type === "delete" && path.posix.dirname(item.relative_path) === (resolved.relative_path || "."))
        .map((item) => path.posix.basename(item.relative_path)),
    )
    const names = new Map<string, boolean>()

    const sourceEntries = await fs.readdir(resolved.source_path, { withFileTypes: true }).catch(() => [])
    for (const entry of sourceEntries) {
      if (deleted.has(entry.name)) continue
      names.set(entry.name, entry.isDirectory())
    }
    const overlayEntries = await fs.readdir(resolved.overlay_path, { withFileTypes: true }).catch(() => [])
    for (const entry of overlayEntries) {
      names.set(entry.name, entry.isDirectory())
    }

    return [...names.entries()]
      .map(([name, directory]) => (directory ? `${name}/` : name))
      .sort((a, b) => a.localeCompare(b))
  }

  /** 中文注释：只在 overlay 根目录里创建或覆盖文件，源码目录始终保持只读。 */
  export async function writeText(input: { overlay: Info; filePath: string; content: string }) {
    const resolved = resolve(input)
    if (!resolved) {
      await fs.mkdir(path.dirname(input.filePath), { recursive: true })
      await Bun.write(input.filePath, input.content)
      return
    }
    await fs.mkdir(path.dirname(resolved.overlay_path), { recursive: true })
    await Bun.write(resolved.overlay_path, input.content)
    const source_exists = await Bun.file(resolved.source_path).exists()
    await upsertChange(input.overlay, {
      solution_id: resolved.mount.solution_id,
      solution_code: resolved.mount.solution_code,
      mount_name: resolved.mount_name,
      relative_path: resolved.relative_path,
      display_path: resolved.display_path,
      change_type: source_exists ? "update" : "create",
      source_file_path: source_exists ? resolved.source_path : undefined,
      overlay_file_path: resolved.overlay_path,
      size: await Filesystem.size(resolved.overlay_path),
      hash: await digest(resolved.overlay_path),
    })
  }

  /** 中文注释：在 overlay 中标记删除，既支持删除源码文件，也支持撤销临时新增文件。 */
  export async function deletePath(input: { overlay: Info; filePath: string }) {
    const resolved = resolve(input)
    if (!resolved) {
      await fs.rm(input.filePath, { recursive: true, force: true }).catch(() => undefined)
      return
    }
    await fs.rm(resolved.overlay_path, { recursive: true, force: true }).catch(() => undefined)
    const source_exists = await Bun.file(resolved.source_path).exists()
    if (!source_exists) {
      await removeChange(input.overlay, {
        mount_name: resolved.mount_name,
        relative_path: resolved.relative_path,
      })
      return
    }
    await upsertChange(input.overlay, {
      solution_id: resolved.mount.solution_id,
      solution_code: resolved.mount.solution_code,
      mount_name: resolved.mount_name,
      relative_path: resolved.relative_path,
      display_path: resolved.display_path,
      change_type: "delete",
      source_file_path: resolved.source_path,
    })
  }

  /** 中文注释：返回当前 overlay 中的全部变更条目，供构建中心详情与编译阶段复用。 */
  export async function listChanges(info: Info) {
    return (await syncManifest(info)).sort((a, b) => a.display_path.localeCompare(b.display_path))
  }

  /** 中文注释：按 mount 和解决方案过滤变更，用于 compile sandbox 只应用本方案的变更。 */
  export async function changesBySolution(input: { overlay: Info; solution_id: string }) {
    return (await listChanges(input.overlay)).filter((item) => item.solution_id === input.solution_id)
  }

  /** 中文注释：把指定方案的 overlay 变更应用到目标编译目录，供 compile sandbox 复用。 */
  export async function applyToMount(input: {
    overlay: Info
    solution_id: string
    mount_name: string
    target_directory: string
  }) {
    const changes = (await changesBySolution({ overlay: input.overlay, solution_id: input.solution_id })).filter(
      (item) => item.mount_name === input.mount_name,
    )
    for (const change of changes) {
      const target = path.join(input.target_directory, change.relative_path)
      if (change.change_type === "delete") {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
        continue
      }
      if (!change.overlay_file_path) continue
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(change.overlay_file_path, target)
    }
    return changes
  }

  /** 中文注释：把临时沙盒某个挂载目录的最终文件状态重新收敛回 overlay，仅保留真实变更文件。 */
  export async function captureMount(input: { overlay: Info; mount_name: string; target_directory: string }) {
    const current = mount(input.overlay, input.mount_name)
    if (!current) return [] as Change[]

    await fs.rm(current.overlay_directory, { recursive: true, force: true }).catch(() => undefined)
    await fs.mkdir(current.overlay_directory, { recursive: true })

    const source_files = await files(current.source_directory)
    const target_files = await files(input.target_directory)
    const union = [...new Set([...source_files, ...target_files])].sort((a, b) => a.localeCompare(b))
    const changes = [] as Change[]

    for (const relative_path of union) {
      const source_file_path = path.join(current.source_directory, relative_path)
      const target_file_path = path.join(input.target_directory, relative_path)
      const overlay_file_path = path.join(current.overlay_directory, relative_path)
      const source_exists = await Bun.file(source_file_path).exists()
      const target_exists = await Bun.file(target_file_path).exists()
      if (source_exists && !target_exists) {
        changes.push({
          solution_id: current.solution_id,
          solution_code: current.solution_code,
          mount_name: current.mount_name,
          relative_path,
          display_path: `${current.mount_name}/${relative_path}`,
          change_type: "delete",
          source_file_path,
        })
        continue
      }
      if (!target_exists) continue

      const target_hash = await digest(target_file_path)
      if (source_exists && target_hash === (await digest(source_file_path))) continue

      await fs.mkdir(path.dirname(overlay_file_path), { recursive: true })
      await fs.copyFile(target_file_path, overlay_file_path)
      changes.push({
        solution_id: current.solution_id,
        solution_code: current.solution_code,
        mount_name: current.mount_name,
        relative_path,
        display_path: `${current.mount_name}/${relative_path}`,
        change_type: source_exists ? "update" : "create",
        source_file_path: source_exists ? source_file_path : undefined,
        overlay_file_path,
        size: await Filesystem.size(overlay_file_path),
        hash: target_hash,
      })
    }

    const merged = [
      ...(await manifest(input.overlay)).changes.filter((item) => item.mount_name !== input.mount_name),
      ...changes,
    ].sort((a, b) => a.display_path.localeCompare(b.display_path))
    await save(input.overlay, merged)
    return changes
  }

  /** 中文注释：按合并视图枚举文件列表，供 glob 和 grep 在 overlay 模式下进行统一扫描。 */
  export async function scanFiles(input: {
    overlay: Info
    directory: string
    pattern?: string
    limit?: number
  }) {
    const root = path.resolve(input.directory)
    const files = [] as string[]

    /** 中文注释：递归遍历 overlay 合并目录树，并按需做 glob 过滤与数量截断。 */
    async function walk(directory: string) {
      if (input.limit && files.length >= input.limit) return
      const entries = await listDirectory({ overlay: input.overlay, directory })
      for (const entry of entries) {
        if (input.limit && files.length >= input.limit) return
        const next = path.join(directory, entry.replace(/\/$/, ""))
        if (entry.endsWith("/")) {
          await walk(next)
          continue
        }
        const relative_path = relative(path.relative(root, next))
        if (input.pattern && !Glob.match(input.pattern, relative_path)) continue
        files.push(next)
      }
    }

    await walk(root)
    return files
  }
}
