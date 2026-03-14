import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import fs from "fs/promises"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { git } from "../util/git"
import { Glob } from "../util/glob"
import { createHash } from "crypto"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { AccountCurrent } from "@/user/current"

export namespace Project {
  const log = Log.create({ service: "project" })

  function gitpath(cwd: string, name: string) {
    if (!name) return cwd
    // git output includes trailing newlines; keep path whitespace intact.
    name = name.replace(/[\r\n]+$/, "")
    if (!name) return cwd

    name = Filesystem.windowsPath(name)

    if (path.isAbsolute(name)) return path.normalize(name)
    return path.resolve(cwd, name)
  }

  function scoped(base: string, worktree: string) {
    const normalized = Filesystem.windowsPath(path.resolve(worktree)).toLowerCase()
    const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 12)
    return `${base}_${digest}`
  }

  /** 中文注释：为批量父目录生成稳定的伪项目标识，避免所有非 git 目录都坍缩到 global。 */
  function batchProjectID(directory: string) {
    const normalized = Filesystem.windowsPath(path.resolve(directory)).toLowerCase()
    const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 12)
    return `batch_${digest}`
  }

  /** 中文注释：批量父目录优先复用当前账号上下文项目或同 worktree 的正式项目，避免生成临时 batch 项目后切项目丢会话。 */
  async function preferredBatchProject(input: { directory: string; fallbackID: string }) {
    const rows = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, input.directory)).all())
    if (rows.length === 0) return
    const context_project_id = Flag.TPCODE_ACCOUNT_ENABLED ? AccountCurrent.optional()?.context_project_id : undefined
    if (context_project_id) {
      const exact = rows.find((row) => row.id === context_project_id)
      if (exact) return exact
    }
    const named = rows.find((row) => !row.id.startsWith("batch_"))
    if (named) return named
    return rows.find((row) => row.id === input.fallbackID) ?? rows[0]
  }

  /** 中文注释：当批量父目录从临时 batch 项目切换到正式项目 ID 时，迁移已有会话归属，避免切项目后会话丢失。 */
  async function migrateBatchProject(input: { fromID: string; toID: string }) {
    if (input.fromID === input.toID) return
    const source = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, input.fromID)).get())
    const target = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, input.toID)).get())
    if (!target) return

    await Database.use((db) =>
      db.update(SessionTable).set({ project_id: input.toID }).where(eq(SessionTable.project_id, input.fromID)).run(),
    )

    if (!source) return
    const sandboxes = [...new Set([...(target.sandboxes ?? []), ...(source.sandboxes ?? [])])]
    await Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          sandboxes,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, input.toID))
        .run(),
    )
  }

  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: row.id,
      worktree: row.worktree,
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  /** 中文注释：批量父项目只保留已注册的 batch_worktree 目录，顺手剔除不存在的旧沙盒，避免把遗留 single-worktree 显示成“沙盒main”。 */
  async function sanitizeSandboxes(info: Info) {
    const existing = info.sandboxes.filter((item) => existsSync(item))
    if (info.vcs === "git") return existing
    if ((await workspaceMode(info.worktree)) !== "batch") return existing
    const rows = await Database.use((db) =>
      db.select({ directory: WorkspaceTable.directory, kind: WorkspaceTable.kind }).from(WorkspaceTable).where(eq(WorkspaceTable.project_id, info.id)).all(),
    )
    const allowed = new Set(
      rows
        .filter((row) => row.kind === "batch_worktree")
        .map((row) => Filesystem.windowsPath(path.resolve(row.directory)).toLowerCase()),
    )
    return existing.filter((directory) => allowed.has(Filesystem.windowsPath(path.resolve(directory)).toLowerCase()))
  }

  /** 中文注释：读取项目后统一清洗沙盒列表，并把结果回写数据库，确保前端不会继续看到批量项目的遗留旧沙盒。 */
  async function normalize(info: Info) {
    const sandboxes = await sanitizeSandboxes(info)
    if (sandboxes.length === info.sandboxes.length && sandboxes.every((item, index) => item === info.sandboxes[index])) {
      return info
    }
    const next = {
      ...info,
      sandboxes,
      time: {
        ...info.time,
        updated: Date.now(),
      },
    }
    await Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          sandboxes: next.sandboxes,
          time_updated: next.time.updated,
        })
        .where(eq(ProjectTable.id, info.id))
        .run(),
    ).catch(() => undefined)
    return next
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })
    directory = path.resolve(directory)

    const workspace = await Database.use((db) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.directory, directory)).get(),
    )
    if (workspace) {
      const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, workspace.project_id)).get())
      if (row) {
        const project = fromRow(row)
        const result = {
          ...project,
          sandboxes: [...project.sandboxes.filter((item) => existsSync(item)), workspace.directory]
            .filter((item, index, list) => list.indexOf(item) === index),
          time: {
            ...project.time,
            updated: Date.now(),
          },
        }
        return {
          project: result,
          sandbox: workspace.directory,
        }
      }
    }

    const data = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()
      if (dotgit) {
        let sandbox = path.dirname(dotgit)

        const gitBinary = Bun.which("git")

        // cached id calculation
        let id = await Filesystem.readText(path.join(dotgit, "opencode"))
          .then((x) => x.trim())
          .catch(() => undefined)

        if (!gitBinary) {
          return {
            id: id ?? "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // generate id from root commit
        if (!id) {
          const roots = await git(["rev-list", "--max-parents=0", "--all"], {
            cwd: sandbox,
          })
            .then(async (result) =>
              (await result.text())
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
            .catch(() => undefined)

          if (!roots) {
            return {
              id: "global",
              worktree: sandbox,
              sandbox: sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          id = roots[0]
          if (id) {
            await Filesystem.write(path.join(dotgit, "opencode"), id).catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: "git",
          }
        }

        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then(async (result) => gitpath(sandbox, await result.text()))
          .catch(() => undefined)

        if (!top) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        const worktree = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then(async (result) => {
            const common = gitpath(sandbox, await result.text())
            // Avoid going to parent of sandbox when git-common-dir is empty.
            return common === sandbox ? sandbox : path.dirname(common)
          })
          .catch(() => undefined)

        if (!worktree) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      if ((await workspaceMode(directory)) === "batch") {
        return {
          id: batchProjectID(directory),
          worktree: directory,
          sandbox: directory,
          vcs: undefined,
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    const batch_row = data.id.startsWith("batch_")
      ? await preferredBatchProject({
          directory: data.worktree,
          fallbackID: data.id,
        })
      : undefined

    if (batch_row && batch_row.id !== data.id) {
      await migrateBatchProject({
        fromID: data.id,
        toID: batch_row.id,
      })
    }

    const legacy_id = batch_row?.id ?? data.id
    const scoped_id = legacy_id === "global" || legacy_id.startsWith("batch_") ? legacy_id : scoped(legacy_id, data.worktree)
    const legacy_row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, legacy_id)).get())
    const scoped_row =
      scoped_id === legacy_id
        ? legacy_row
        : await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, scoped_id)).get())
    let project_id = legacy_id
    if (legacy_id !== "global") {
      if (scoped_row) project_id = scoped_id
      else if (!legacy_row) project_id = scoped_id
      else if (legacy_row.worktree !== data.worktree) project_id = scoped_id
    }
    const row = project_id === legacy_id ? legacy_row : scoped_row
    const existing = await iife(async () => {
      if (row) return fromRow(row)
      const fresh: Info = {
        id: project_id,
        worktree: data.worktree,
        vcs: data.vcs as Info["vcs"],
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (project_id !== "global") {
        await migrateFromGlobal(project_id, data.worktree)
      }
      return fresh
    })

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      vcs: data.vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox)) result.sandboxes.push(data.sandbox)
    result.sandboxes = await sanitizeSandboxes({
      ...result,
      sandboxes: result.sandboxes.filter((x) => existsSync(x)),
    })
    const insert = {
      id: result.id,
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_created: result.time.created,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    const updateSet = {
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    await Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const buffer = await Filesystem.readBytes(shortest)
    const base64 = buffer.toString("base64")
    const mime = Filesystem.mimeType(shortest) || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  /** 中文注释：识别目录是否支持工作区能力；非 git 父目录只要一级子目录存在 git 项目就进入 batch 模式。 */
  export async function workspaceMode(directory: string) {
    const root = path.resolve(directory)
    if (await Filesystem.exists(path.join(root, ".git"))) return "single" as const

    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const matches = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => Filesystem.exists(path.join(root, entry.name, ".git"))),
    )
    if (matches.some(Boolean)) return "batch" as const
    return "none" as const
  }

  async function migrateFromGlobal(id: string, worktree: string) {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, "global")).get())
    if (!row) return

    const sessions = await Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.project_id, "global")).all(),
    )
    if (sessions.length === 0) return

    log.info("migrating sessions from global", { newProjectID: id, worktree, count: sessions.length })

    await work(10, sessions, async (row) => {
      // Skip sessions that belong to a different directory
      if (row.directory && row.directory !== worktree) return

      log.info("migrating session", { sessionID: row.id, from: "global", to: id })
      await Database.use((db) => db.update(SessionTable).set({ project_id: id }).where(eq(SessionTable.id, row.id)).run())
    }).catch((error) => {
      log.error("failed to migrate sessions from global to project", { error, projectId: id })
    })
  }

  export async function setInitialized(id: string) {
    await Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export async function list() {
    const rows = await Database.use((db) => db.select().from(ProjectTable).all())
    return Promise.all(rows.map((row) => normalize(fromRow(row))))
  }

  export async function get(id: string): Promise<Info | undefined> {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return normalize(fromRow(row))
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const result = await Database.use((db) =>
        db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .all(),
      )
      const row = result[0]
      if (!row) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(row)
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export async function sandboxes(id: string) {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const s = Filesystem.stat(dir)
      if (s?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: string, directory: string) {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = await Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .all(),
    )
    const next = result[0]
    if (!next) throw new Error(`Project not found: ${id}`)
    const data = fromRow(next)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: string, directory: string) {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = row.sandboxes.filter((s) => s !== directory)
    const result = await Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .all(),
    )
    const next = result[0]
    if (!next) throw new Error(`Project not found: ${id}`)
    const data = fromRow(next)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
