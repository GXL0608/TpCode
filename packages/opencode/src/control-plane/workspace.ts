import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { Identifier } from "@/id/id"
import { fn } from "@/util/fn"
import { Database, eq, or } from "@/storage/db"
import { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { WorkspaceTable } from "./workspace.sql"
import { Config } from "./config"
import { getAdaptor } from "./adaptors"
import { parseSSE } from "./sse"
import { BatchMeta, WorkspaceKind, type BatchMember } from "./workspace-meta"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Worktree } from "@/worktree"
import { SessionTable } from "@/session/session.sql"

export namespace Workspace {
  const log = Log.create({ service: "workspace-sync" })

  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      directory: z.string(),
      branch: z.string().nullable(),
      kind: WorkspaceKind,
      projectID: z.string(),
      config: Config,
      meta: BatchMeta.optional(),
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.infer<typeof Info>

  /** 中文注释：把数据库行统一转换成工作区信息对象，供 session、server 和前端接口复用。 */
  function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
    return {
      id: row.id,
      directory: row.directory,
      branch: row.branch,
      kind: row.kind,
      projectID: row.project_id,
      config: row.config,
      meta: row.meta ?? undefined,
    }
  }

  /** 中文注释：将任意名称规整成可用于分支和目录名的短 slug。 */
  function slug(input: string) {
    const text = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    return text || `batch-${Date.now()}`
  }

  /** 中文注释：为批量沙盒挑选一个未占用的聚合根目录与共享分支名。 */
  async function batchSlot(input: { projectID: string; name: string }) {
    const root = path.join(Global.Path.data, "batch-worktree", input.projectID)
    await fs.mkdir(root, { recursive: true })

    for (const attempt of Array.from({ length: 26 }, (_, index) => index)) {
      const name = attempt === 0 ? slug(input.name) : `${slug(input.name)}-${attempt + 1}`
      const directory = path.join(root, name)
      if (await Filesystem.exists(directory)) continue
      return {
        name,
        branch: `opencode/${name}`,
        directory,
      }
    }

    throw new Error("Failed to allocate batch workspace directory")
  }

  /** 中文注释：扫描父目录的一级子目录，筛出可参与批量沙盒的 git 项目。 */
  async function batchMembers(sourceRoot: string, sandboxRoot: string, branch: string) {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => [])
    const members = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const source_directory = path.join(sourceRoot, entry.name)
          if (!(await Filesystem.exists(path.join(source_directory, ".git")))) return
          return {
            name: entry.name,
            relative_path: entry.name,
            source_directory,
            sandbox_directory: path.join(sandboxRoot, entry.name),
            branch,
          }
        }),
    )

    return members.filter((item): item is NonNullable<typeof item> => Boolean(item))
  }

  /** 中文注释：在新建 worktree 后执行一次硬重置，确保成员目录具备可用工作副本。 */
  async function populate(directory: string) {
    for (const _ of Array.from({ length: 20 })) {
      const result = await $`git reset --hard`.quiet().nothrow().cwd(directory)
      if (result.exitCode === 0) return
      await Bun.sleep(250)
    }
    throw new Error(`Failed to populate batch member worktree: ${directory}`)
  }

  /** 中文注释：识别成员仓库的默认分支，优先 remote HEAD，失败时回退常见主分支与当前分支。 */
  async function defaultBranch(cwd: string) {
    const remote = await $`git symbolic-ref refs/remotes/origin/HEAD`.quiet().nothrow().cwd(cwd)
    if (remote.exitCode === 0) {
      const ref = remote.stdout.toString().trim()
      const branch = ref.replace(/^refs\/remotes\/origin\//, "")
      if (branch) return branch
    }

    for (const item of ["dev", "main", "master"] as const) {
      const found = await $`git show-ref --verify --quiet refs/heads/${item}`.quiet().nothrow().cwd(cwd)
      if (found.exitCode === 0) return item
    }

    const current = await $`git branch --show-current`.quiet().nothrow().cwd(cwd)
    return current.exitCode === 0 ? current.stdout.toString().trim() || undefined : undefined
  }

  /** 中文注释：读取成员仓库当前基线提交，用于后续 batch review/diff 计算整个会话累计改动。 */
  async function baseRef(cwd: string) {
    const current = await $`git rev-parse HEAD`.quiet().nothrow().cwd(cwd)
    if (current.exitCode !== 0) return
    return current.stdout.toString().trim() || undefined
  }

  /** 中文注释：复制父目录顶层非 git 条目到聚合根目录，仅用于保留目录壳层，不参与状态管理。 */
  async function copyOverlay(sourceRoot: string, sandboxRoot: string, names: string[]) {
    const skip = new Set(names)
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        if (skip.has(entry.name)) return
        const source = path.join(sourceRoot, entry.name)
        const target = path.join(sandboxRoot, entry.name)
        await fs.cp(source, target, { recursive: true, force: true })
      }),
    )
  }

  /** 中文注释：刷新聚合根目录中的顶层非 git 壳层，仅保留成员目录并重拷贝父目录其它顶层条目。 */
  async function refreshOverlay(sourceRoot: string, sandboxRoot: string, names: string[]) {
    const keep = new Set(names)
    const entries = await fs.readdir(sandboxRoot, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        if (keep.has(entry.name)) return
        await fs.rm(path.join(sandboxRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)
      }),
    )
    await copyOverlay(sourceRoot, sandboxRoot, names)
  }

  /** 中文注释：把批量成员 worktree 原地重置到受保护默认分支，避免 reset 时删表重建造成 session 失联。 */
  async function resetMember(member: BatchMember) {
    const remoteList = await $`git remote`.quiet().nothrow().cwd(member.sandbox_directory)
    const remotes = remoteList.stdout
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes("upstream")
          ? "upstream"
          : ""
    const branch = member.default_branch
    const remoteTarget = remote && branch ? `${remote}/${branch}` : ""
    const localCheck = branch
      ? await $`git show-ref --verify --quiet refs/heads/${branch}`.quiet().nothrow().cwd(member.sandbox_directory)
      : undefined
    const localTarget = branch && localCheck?.exitCode === 0 ? branch : ""
    const target = remoteTarget || localTarget || "HEAD"

    if (remote && branch) {
      const fetched = await $`git fetch ${remote} ${branch}`.quiet().nothrow().cwd(member.sandbox_directory)
      if (fetched.exitCode !== 0) {
        throw new Error(fetched.stderr.toString().trim() || `Failed to fetch ${member.name}`)
      }
    }

    const reset = await $`git reset --hard ${target}`.quiet().nothrow().cwd(member.sandbox_directory)
    if (reset.exitCode !== 0) {
      throw new Error(reset.stderr.toString().trim() || `Failed to reset ${member.name}`)
    }

    const clean = await $`git clean -fdx`.quiet().nothrow().cwd(member.sandbox_directory)
    if (clean.exitCode !== 0) {
      throw new Error(clean.stderr.toString().trim() || `Failed to clean ${member.name}`)
    }

    const submodules = await $`git submodule status --recursive`.quiet().nothrow().cwd(member.sandbox_directory)
    if (submodules.exitCode === 0 && submodules.stdout.toString().trim()) {
      await $`git submodule update --init --recursive --force`.quiet().nothrow().cwd(member.sandbox_directory)
      await $`git submodule foreach --recursive git reset --hard`.quiet().nothrow().cwd(member.sandbox_directory)
      await $`git submodule foreach --recursive git clean -fdx`.quiet().nothrow().cwd(member.sandbox_directory)
    }

    const nextBase = await baseRef(member.sandbox_directory)
    return {
      ...member,
      base_ref: nextBase ?? member.base_ref,
      status: "ready" as const,
    }
  }

  /** 中文注释：整批清理批量沙盒成员 worktree 与聚合目录，供失败回滚、删除和重置复用。 */
  async function cleanupBatch(row: Pick<Info, "directory" | "meta" | "projectID">, removeRoot = true) {
    const members = row.meta?.members ?? []
    await Promise.all(
      members.map(async (member) => {
        await Instance.provide({
          directory: member.source_directory,
          fn: async () => {
            await Worktree.remove({ directory: member.sandbox_directory }).catch(async () => {
              if (await Filesystem.exists(member.sandbox_directory)) {
                await fs.rm(member.sandbox_directory, { recursive: true, force: true })
              }
            })
          },
        }).catch(async () => {
          if (await Filesystem.exists(member.sandbox_directory)) {
            await fs.rm(member.sandbox_directory, { recursive: true, force: true })
          }
        })
      }),
    )
    if (removeRoot) {
      await fs.rm(row.directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** 中文注释：删除批量沙盒后，把仍指向该工作区的 session 解绑回源目录，避免前端继续挂着已删除的沙盒目录。 */
  async function detachBatch(row: Pick<Info, "id" | "directory" | "meta">) {
    const fallback = row.meta?.source_root ?? row.directory
    await Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          directory: fallback,
          workspace_id: null,
          workspace_directory: null,
          workspace_branch: null,
          workspace_kind: null,
          workspace_status: "removed",
          workspace_cleanup_status: "deleted",
          time_updated: Date.now(),
        })
        .where(or(eq(SessionTable.workspace_id, row.id), eq(SessionTable.workspace_directory, row.directory)))
        .run(),
    )
  }

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)

      const { config, init } = await getAdaptor(input.config).create(input.config, input.branch)
      const info: Info = {
        id,
        directory: config.directory,
        branch: input.branch,
        kind: config.type === "batch_worktree" ? "batch_worktree" : "single_worktree",
        projectID: input.projectID,
        config,
      }

      setTimeout(async () => {
        await init()

        await Database.use(async (db) => {
          await db.insert(WorkspaceTable)
            .values({
              id: info.id,
              directory: info.directory,
              branch: info.branch,
              kind: info.kind,
              project_id: info.projectID,
              config: info.config,
              meta: null,
            })
            .run()
        })

        GlobalBus.emit("event", {
          directory: id,
          payload: {
            type: Event.Ready.type,
            properties: {},
          },
        })
      }, 0)

      return info
    },
  )

  export const createBatch = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: z.string(),
      sourceRoot: z.string(),
      name: z.string(),
      directory: z.string().optional(),
      branch: z.string().optional(),
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)
      const slot =
        input.directory && input.branch
          ? {
              directory: input.directory,
              branch: input.branch,
            }
          : await batchSlot({
              projectID: input.projectID,
              name: input.name,
            })
      const members = await batchMembers(input.sourceRoot, slot.directory, slot.branch)
      if (members.length === 0) {
        throw new Error("No git members found for batch workspace")
      }

      await fs.mkdir(slot.directory, { recursive: true })
      const ready: BatchMember[] = []

      try {
        for (const member of members) {
          const created = await (
            (await Worktree.hasBaseCommit(member.source_directory))
              ? $`git worktree add --no-checkout -b ${member.branch} ${member.sandbox_directory}`
              : $`git worktree add -b ${member.branch} ${member.sandbox_directory}`
          )
            .quiet()
            .nothrow()
            .cwd(member.source_directory)
          if (created.exitCode !== 0) {
            throw new Error(created.stderr.toString().trim() || `Failed to create batch member ${member.name}`)
          }

          ready.push({
            ...member,
            base_ref: await baseRef(member.source_directory),
            status: "failed" as const,
          })
          await populate(member.sandbox_directory)
          const next = ready[ready.length - 1]
          if (!next) continue
          next.default_branch = await defaultBranch(member.source_directory)
          next.status = "ready"
        }

        await copyOverlay(input.sourceRoot, slot.directory, ready.map((item) => item.name))

        await Database.use((db) =>
          db
            .insert(WorkspaceTable)
            .values({
              id,
              directory: slot.directory,
              branch: slot.branch,
              kind: "batch_worktree",
              project_id: input.projectID,
              config: {
                type: "batch_worktree",
                directory: slot.directory,
              },
              meta: {
                source_root: input.sourceRoot,
                members: ready,
              },
            })
            .run(),
        )
        await Project.addSandbox(input.projectID, slot.directory)
        return Info.parse({
          id,
          directory: slot.directory,
          branch: slot.branch,
          kind: "batch_worktree",
          projectID: input.projectID,
          config: {
            type: "batch_worktree",
            directory: slot.directory,
          },
          meta: {
            source_root: input.sourceRoot,
            members: ready,
          },
        })
      } catch (error) {
        await cleanupBatch(
          {
            directory: slot.directory,
            meta: {
              source_root: input.sourceRoot,
              members: ready,
            },
            projectID: input.projectID,
          },
          true,
        )
        throw error
      }
    },
  )

  export async function list(project: Project.Info) {
    const rows = await Database.use((db) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id)).all(),
    )
    return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    const row = await Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
    if (!row) return
    return fromRow(row)
  })

  /** 中文注释：按入口目录查询工作区，供非 git 聚合目录重新映射回所属项目。 */
  export const getByDirectory = fn(z.string(), async (directory) => {
    const row = await Database.use((db) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.directory, directory)).get(),
    )
    if (!row) return
    return fromRow(row)
  })

  export const resetBatch = fn(Identifier.schema("workspace"), async (id) => {
    const row = await get(id)
    if (!row || row.kind !== "batch_worktree" || !row.meta) return false
    const members = [] as BatchMember[]
    for (const member of row.meta.members) {
      members.push(await resetMember(member))
    }
    await refreshOverlay(row.meta.source_root, row.directory, members.map((item) => item.name))
    await Database.use((db) =>
      db
        .update(WorkspaceTable)
        .set({
          branch: row.branch,
          meta: {
            source_root: row.meta!.source_root,
            members,
          },
        })
        .where(eq(WorkspaceTable.id, id))
        .run(),
    )
    return true
  })

  export const removeBatch = fn(Identifier.schema("workspace"), async (id) => {
    const row = await get(id)
    if (!row || row.kind !== "batch_worktree") return
    await cleanupBatch(row, true).catch((error) => {
      log.warn("batch workspace filesystem cleanup failed", {
        workspaceID: id,
        directory: row.directory,
        error,
      })
    })
    await detachBatch(row).catch((error) => {
      log.warn("batch workspace session detach failed", {
        workspaceID: id,
        directory: row.directory,
        error,
      })
    })
    await Project.removeSandbox(row.projectID, row.directory).catch((error) => {
      log.warn("batch workspace project sandbox detach failed", {
        workspaceID: id,
        directory: row.directory,
        error,
      })
    })
    await Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run()).catch((error) => {
      log.warn("batch workspace row delete failed", {
        workspaceID: id,
        directory: row.directory,
        error,
      })
    })
    return row
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const row = await Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
    if (!row) return
    const info = fromRow(row)
    if (info.kind === "batch_worktree") {
      return removeBatch(id)
    }
    await getAdaptor(info.config).remove(info.config)
    await Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
    return info
  })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    while (!stop.aborted) {
      const res = await getAdaptor(space.config)
        .request(space.config, "GET", "/event", undefined, stop)
        .catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        await Bun.sleep(1000)
        continue
      }
      await parseSSE(res.body, stop, (event) => {
        GlobalBus.emit("event", {
          directory: space.id,
          payload: event,
        })
      })
      await Bun.sleep(250)
    }
  }

  export async function startSyncing(project: Project.Info) {
    const stop = new AbortController()
    const spaces = (await list(project)).filter(
      (space) => space.config.type !== "worktree" && space.config.type !== "batch_worktree",
    )

    spaces.forEach((space) => {
      void workspaceEventLoop(space, stop.signal).catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
    })

    return {
      async stop() {
        stop.abort()
      },
    }
  }
}
