import { Slug } from "@opencode-ai/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Identifier } from "../id/id"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, or, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import type { SQL } from "../storage/db"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Project } from "../project/project"
import { Storage } from "@/storage/storage"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"

import { Provider } from "@/provider/provider"
import { PermissionNext } from "@/permission/next"
import { Global } from "@/global"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { iife } from "@/util/iife"
import { AccountCurrent } from "@/user/current"
import { TokenUsageService } from "@/usage/service"
import { AccountSystemSettingService } from "@/user/system-setting"
import { Lock } from "@/util/lock"
import { Worktree } from "@/worktree"
import { Filesystem } from "@/util/filesystem"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"

export namespace Session {
  const log = Log.create({ service: "session" })

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "
  const WorkspaceStatus = z.enum(["pending", "ready", "failed", "removed"])
  const WorkspaceCleanupStatus = z.enum(["none", "pending", "failed", "deleted"])

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect
  const RuntimeModelSource = z.enum(["single", "pool", "manual"])
  type RuntimeModelSource = z.infer<typeof RuntimeModelSource>
  type RuntimeModelState = {
    providerID: string
    modelID: string
    source: RuntimeModelSource
  }

  function actor() {
    if (!Flag.TPCODE_ACCOUNT_ENABLED) return
    return AccountCurrent.optional()
  }

  function canRead(row: SessionRow) {
    const a = actor()
    if (!a) return true
    if (!row.user_id) return false
    if (row.user_id !== a.user_id) return false
    const project_id = row.context_project_id ?? row.project_id
    if (!a.context_project_id) return project_id === "global"
    return project_id === a.context_project_id
  }

  function canWrite(row: SessionRow) {
    const a = actor()
    if (!a) return true
    if (!row.user_id) return false
    if (row.user_id !== a.user_id) return false
    const project_id = row.context_project_id ?? row.project_id
    if (!a.context_project_id) return project_id === "global"
    return project_id === a.context_project_id
  }

  async function assertWritable(sessionID: string) {
    const row = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
    if (!canWrite(row)) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
    return row
  }

  function runtimeState(row: SessionRow) {
    const source = RuntimeModelSource.safeParse(row.runtime_model_source)
    if (!source.success) return
    if (!row.runtime_provider_id || !row.runtime_model_id) return
    return {
      providerID: row.runtime_provider_id,
      modelID: row.runtime_model_id,
      source: source.data,
    } satisfies RuntimeModelState
  }

  function workspaceReady(row: SessionRow) {
    if (!row.workspace_directory) return false
    if (WorkspaceStatus.safeParse(row.workspace_status).data !== "ready") return false
    return true
  }

  function workspaceDirectory(row: SessionRow) {
    return row.workspace_directory ?? undefined
  }

  async function projectRow(projectID: string) {
    const row = await Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get())
    if (!row) throw new NotFoundError({ message: `Project not found: ${projectID}` })
    return row
  }

  async function dirty(directory: string) {
    const result = await $`git status --porcelain=v1`.quiet().nothrow().cwd(directory)
    if (result.exitCode !== 0) return false
    return result.stdout.toString().trim().length > 0
  }

  async function removeWorkspace(input: { projectID: string; directory: string }) {
    await Worktree.remove({ directory: input.directory }).catch(async (error) => {
      if (await Filesystem.exists(input.directory)) throw error
    })
    await Project.removeSandbox(input.projectID, input.directory)
  }

  export const BuildWorkspacePreview = z.object({
    has_workspace: z.boolean(),
    dirty: z.boolean(),
    directory: z.string().optional(),
  })
  export type BuildWorkspacePreview = z.infer<typeof BuildWorkspacePreview>

  export const WorkspaceDirtyError = NamedError.create(
    "SessionWorkspaceDirtyError",
    z.object({
      sessionID: z.string(),
      message: z.string(),
    }),
  )

  function pick<T extends { weight: number }>(items: T[]) {
    const total = items.reduce((sum, item) => sum + item.weight, 0)
    let n = Math.random() * total
    return (
      items.find((item) => {
        n -= item.weight
        return n < 0
      }) ?? items[items.length - 1]
    )
  }

  async function availablePool() {
    const [control, providers] = await Promise.all([AccountSystemSettingService.providerControl(), Provider.list()])
    return (control.session_model_pool ?? [])
      .map((item) => ({
        provider_id: item.provider_id,
        weight: item.weight,
        models: item.models.filter((model) => providers[item.provider_id]?.models[model.model_id]),
      }))
      .filter((item) => providers[item.provider_id] && item.models.length > 0)
  }

  async function persistRuntimeModel(sessionID: string, input: RuntimeModelState) {
    await Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          runtime_provider_id: input.providerID,
          runtime_model_id: input.modelID,
          runtime_model_source: input.source,
        })
        .where(eq(SessionTable.id, sessionID))
        .run(),
    )
  }

  /** 中文注释：清空 session 级手动模型状态，恢复系统自动选择。 */
  async function clearRuntimeState(sessionID: string) {
    await Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          runtime_provider_id: null,
          runtime_model_id: null,
          runtime_model_source: null,
        })
        .where(eq(SessionTable.id, sessionID))
        .run(),
    )
  }

  /** 中文注释：设置当前 session 的手动模型。 */
  export async function setRuntimeModel(sessionID: string, input: { providerID: string; modelID: string }) {
    await assertWritable(sessionID)
    await persistRuntimeModel(sessionID, {
      providerID: input.providerID,
      modelID: input.modelID,
      source: "manual",
    })
  }

  /** 中文注释：清除当前 session 的手动模型。 */
  export async function clearRuntimeModel(sessionID: string) {
    await assertWritable(sessionID)
    await clearRuntimeState(sessionID)
  }

  export async function runtimeModel(sessionID: string) {
    if (!Flag.TPCODE_ACCOUNT_ENABLED) return Provider.runtimeModel()
    const row = await assertWritable(sessionID)
    const current = runtimeState(row)
    const providers = await Provider.list()
    if (current?.source === "manual" && providers[current.providerID]?.models[current.modelID]) {
      return {
        providerID: current.providerID,
        modelID: current.modelID,
      }
    }
    if (current?.source === "single" && providers[current.providerID]?.models[current.modelID]) {
      return {
        providerID: current.providerID,
        modelID: current.modelID,
      }
    }

    const pool = await availablePool()
    if (
      current?.source === "pool" &&
      pool.some(
        (item) =>
          item.provider_id === current.providerID && item.models.some((model) => model.model_id === current.modelID),
      )
    ) {
      return {
        providerID: current.providerID,
        modelID: current.modelID,
      }
    }

    const next = iife(() => {
      if (pool.length === 0) return
      const provider = pick(pool)
      const model = pick(provider.models)
      return {
        providerID: provider.provider_id,
        modelID: model.model_id,
        source: "pool",
      } satisfies RuntimeModelState
    })
    const fallback = next ?? {
      ...(await Provider.defaultModel()),
      source: "single" as const,
    }

    if (
      current?.providerID !== fallback.providerID ||
      current?.modelID !== fallback.modelID ||
      current?.source !== fallback.source
    ) {
      await persistRuntimeModel(sessionID, fallback)
    }
    return {
      providerID: fallback.providerID,
      modelID: fallback.modelID,
    }
  }

  export async function readableSessionIDs(sessionIDs: string[]) {
    if (sessionIDs.length === 0) return new Set<string>()
    const a = actor()
    if (!a) return new Set(sessionIDs)
    const result = new Set<string>()
    const size = 500
    for (let i = 0; i < sessionIDs.length; i += size) {
      const chunk = sessionIDs.slice(i, i + size)
      if (chunk.length === 0) continue
      const rows = await Database.use((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(and(eq(SessionTable.user_id, a.user_id), inArray(SessionTable.id, chunk)))
          .all(),
      )
      for (const row of rows) {
        result.add(row.id)
      }
    }
    return result
  }

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    const runtime_model = runtimeState(row)
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      directory: row.directory,
      workspaceDirectory: row.workspace_directory ?? undefined,
      workspaceBranch: row.workspace_branch ?? undefined,
      workspaceStatus: WorkspaceStatus.safeParse(row.workspace_status).data,
      workspaceCleanupStatus: WorkspaceCleanupStatus.safeParse(row.workspace_cleanup_status).data,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      summary,
      share,
      revert,
      runtime_model,
      permission: row.permission ?? undefined,
      visibility: row.visibility as "private" | "department" | "org" | "public",
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      workspace_directory: info.workspaceDirectory ?? null,
      workspace_branch: info.workspaceBranch ?? null,
      workspace_status: info.workspaceStatus ?? null,
      workspace_cleanup_status: info.workspaceCleanupStatus ?? null,
      title: info.title,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      runtime_provider_id: info.runtime_model?.providerID,
      runtime_model_id: info.runtime_model?.modelID,
      runtime_model_source: info.runtime_model?.source,
      permission: info.permission,
      visibility: info.visibility ?? "private",
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      slug: z.string(),
      projectID: z.string(),
      directory: z.string(),
      workspaceDirectory: z.string().optional(),
      workspaceBranch: z.string().optional(),
      workspaceStatus: WorkspaceStatus.optional(),
      workspaceCleanupStatus: WorkspaceCleanupStatus.optional(),
      parentID: Identifier.schema("session").optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      visibility: z.enum(["private", "department", "org", "public"]),
      revert: z
        .object({
          messageID: z.string(),
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
      runtime_model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
          source: RuntimeModelSource,
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ProjectInfo = z
    .object({
      id: z.string(),
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({
      ref: "ProjectSummary",
    })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  export const GlobalInfo = Info.extend({
    project: ProjectInfo.nullable(),
  }).meta({
    ref: "GlobalSession",
  })
  export type GlobalInfo = z.output<typeof GlobalInfo>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: Identifier.schema("session").optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        visibility: z.enum(["private", "department", "org", "public"]).optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        visibility: input?.visibility,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, string>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = Identifier.ascending("message")
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: Identifier.ascending("part"),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(Identifier.schema("session"), async (sessionID) => {
    await assertWritable(sessionID)
    const now = Date.now()
    await Database.use(async (db) => {
      const row = await db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    id?: string
    title?: string
    parentID?: string
    directory: string
    permission?: PermissionNext.Ruleset
    visibility?: "private" | "department" | "org" | "public"
  }) {
    const a = actor()
    if (a && !a.context_project_id) {
      throw new Error("project_context_required")
    }
    const visibility = a ? "private" : (input.visibility ?? "public")
    const result: Info = {
      id: Identifier.descending("session", input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      visibility,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    await Database.use(async (db) => {
      await db
        .insert(SessionTable)
        .values({
          ...toRow(result),
          context_project_id: a?.context_project_id,
          user_id: a?.user_id,
          org_id: a?.org_id,
          department_id: a?.department_id,
          visibility,
        })
        .run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch(() => {
        // Silently ignore sharing errors during session creation
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".opencode", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  async function read(id: string) {
    const row = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    if (!canRead(row)) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  }

  export const peek = fn(Identifier.schema("session"), async (id) => read(id))

  export const get = fn(Identifier.schema("session"), async (id) => {
    const started = Date.now()
    const info = await read(id)
    log.info("get", {
      event: "session.get",
      session_id: id,
      project_id: info.projectID,
      duration_ms: Date.now() - started,
    })
    return info
  })

  export const share = fn(Identifier.schema("session"), async (id) => {
    await assertWritable(id)
    throw new Error("Session sharing is disabled")
  })

  export const unshare = fn(Identifier.schema("session"), async (id) => {
    await assertWritable(id)
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    await Database.use(async (db) => {
      const row = await db
        .update(SessionTable)
        .set({ share_url: null })
        .where(eq(SessionTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export const setTitle = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      title: z.string(),
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set({ title: input.title })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      time: z.number().optional(),
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set({ time_archived: input.time })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  async function setWorkspaceMeta(input: {
    sessionID: string
    workspaceDirectory?: string | null
    activeDirectory?: string | null
    branch?: string | null
    status?: z.infer<typeof WorkspaceStatus> | null
    cleanup?: z.infer<typeof WorkspaceCleanupStatus> | null
  }) {
    return await Database.use(async (db) => {
      const row = await db
        .update(SessionTable)
        .set({
          directory: input.activeDirectory ?? undefined,
          workspace_directory: input.workspaceDirectory ?? null,
          workspace_branch: input.branch ?? null,
          workspace_status: input.status ?? null,
          workspace_cleanup_status: input.cleanup ?? null,
          time_updated: Date.now(),
        })
        .where(eq(SessionTable.id, input.sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  }

  export const prepareBuild = fn(
    z.object({
      sessionID: Identifier.schema("session"),
    }),
    async (input) => {
      using _ = await Lock.write(`session-build:${input.sessionID}`)
      const row = await assertWritable(input.sessionID)
      const project = await projectRow(row.project_id)
      const status = WorkspaceStatus.safeParse(row.workspace_status).data
      const cleanup = WorkspaceCleanupStatus.safeParse(row.workspace_cleanup_status).data ?? "none"

      if (project.vcs !== "git") return fromRow(row)
      if (workspaceDirectory(row) && status !== "failed" && status !== "removed" && (await Filesystem.isDir(row.workspace_directory))) {
        if (row.directory === row.workspace_directory) return fromRow(row)
        return setWorkspaceMeta({
          sessionID: input.sessionID,
          workspaceDirectory: row.workspace_directory,
          activeDirectory: row.workspace_directory,
          branch: row.workspace_branch,
          status: status ?? "ready",
          cleanup,
        })
      }

      const created = await Worktree.create({
        name: [row.slug, row.id].join("-"),
      })

      const start = Date.now()
      while (Date.now() - start < 30_000) {
        if (await Filesystem.isDir(created.directory)) {
          const status = await $`git status --porcelain=v1`.quiet().nothrow().cwd(created.directory)
          if (status.exitCode === 0) break
        }
        await Bun.sleep(250)
      }

      return setWorkspaceMeta({
        sessionID: input.sessionID,
        workspaceDirectory: created.directory,
        activeDirectory: created.directory,
        branch: created.branch,
        status: "ready",
        cleanup: "none",
      })
    },
  )

  export const archivePreview = fn(Identifier.schema("session"), async (sessionID) => {
    const row = await assertWritable(sessionID)
    const directory = workspaceDirectory(row)
    if (!directory) {
      return {
        has_workspace: false,
        dirty: false,
      } satisfies BuildWorkspacePreview
    }
    const exists = await Filesystem.isDir(directory)
    if (!exists) {
      return {
        has_workspace: true,
        dirty: false,
        directory,
      } satisfies BuildWorkspacePreview
    }
    return {
      has_workspace: true,
      dirty: await dirty(directory),
      directory,
    } satisfies BuildWorkspacePreview
  })

  export const archive = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      time: z.number().optional(),
      force: z.boolean().optional(),
    }),
    async (input) => {
      const row = await assertWritable(input.sessionID)
      const preview = await archivePreview(input.sessionID)
      if (preview.has_workspace && preview.dirty && !input.force) {
        throw new WorkspaceDirtyError({
          sessionID: input.sessionID,
          message: "workspace has uncommitted changes",
        })
      }

      const session = await setArchived({
        sessionID: input.sessionID,
        time: input.time,
      })

      const directory = workspaceDirectory(row)
      if (!preview.has_workspace || !directory) return session

      await Database.use((db) =>
        db
          .update(SessionTable)
          .set({
            workspace_cleanup_status: "pending",
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .run(),
      )

      try {
        await removeWorkspace({
          projectID: row.project_id,
          directory,
        })
        await Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              workspace_status: "removed",
              workspace_cleanup_status: "deleted",
              time_updated: Date.now(),
            })
            .where(eq(SessionTable.id, input.sessionID))
            .run(),
        )
      } catch (error) {
        await Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              workspace_cleanup_status: "failed",
              time_updated: Date.now(),
            })
            .where(eq(SessionTable.id, input.sessionID))
            .run(),
        )
        log.error("archive cleanup failed", {
          sessionID: input.sessionID,
          directory,
          error,
        })
      }

      return await get(input.sessionID)
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set({ permission: input.permission, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setVisibility = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      visibility: z.enum(["private", "department", "org", "public"]),
    }),
    async (input) => {
      const current = await assertWritable(input.sessionID)
      const a = actor()
      const visibility = a ? "private" : input.visibility
      const patch = {
        visibility,
        org_id: visibility === "org" && !current.org_id ? a?.org_id : undefined,
        department_id: visibility === "department" && !current.department_id ? a?.department_id : undefined,
        time_updated: Date.now(),
      }
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set(patch)
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setRevert = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set({
            revert: input.revert ?? null,
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const clearRevert = fn(Identifier.schema("session"), async (sessionID) => {
    await assertWritable(sessionID)
    return await Database.use(async (db) => {
      const row = await db
        .update(SessionTable)
        .set({
          revert: null,
          time_updated: Date.now(),
        })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      summary: Info.shape.summary,
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      return await Database.use(async (db) => {
        const row = await db
          .update(SessionTable)
          .set({
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const diff = fn(Identifier.schema("session"), async (sessionID) => {
    try {
      return await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    } catch {
      return []
    }
  })

  export const messages = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      limit: z.number().optional(),
    }),
    async (input) => {
      const started = Date.now()
      await read(input.sessionID)
      const result = [] as MessageV2.WithParts[]
      let parts = 0
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        parts += msg.parts.length
        result.push(msg)
      }
      result.reverse()
      log.info("messages", {
        event: "session.messages",
        session_id: input.sessionID,
        duration_ms: Date.now() - started,
        message_count: result.length,
        part_count: parts,
        limit: input.limit,
      })
      return result
    },
  )

  export async function* list(input?: {
    directory?: string
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }) {
    const project = Instance.project
    const conditions: SQL[] = [eq(SessionTable.project_id, project.id)]
    const a = actor()
    if (a) {
      conditions.push(eq(SessionTable.user_id, a.user_id))
    }

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (a?.context_project_id) {
      const scope = or(
        eq(SessionTable.context_project_id, a.context_project_id),
        and(isNull(SessionTable.context_project_id), eq(SessionTable.project_id, a.context_project_id)),
      )
      if (scope) {
        conditions.push(scope)
      }
    }

    const limit = input?.limit ?? 100

    const rows = await Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export async function* listGlobal(input?: {
    directory?: string
    roots?: boolean
    start?: number
    cursor?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    const conditions: SQL[] = []
    const a = actor()
    if (a) {
      conditions.push(eq(SessionTable.user_id, a.user_id))
    }

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }
    if (a?.context_project_id) {
      const scope = or(
        eq(SessionTable.context_project_id, a.context_project_id),
        and(isNull(SessionTable.context_project_id), eq(SessionTable.project_id, a.context_project_id)),
      )
      if (scope) {
        conditions.push(scope)
      }
    }

    const limit = input?.limit ?? 100

    const rows = await Database.use((db) => {
      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
    })

    const ids = [...new Set(rows.map((row) => row.project_id))]
    const projects = new Map<string, ProjectInfo>()

    if (ids.length > 0) {
      const items = await Database.use((db) =>
        db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all(),
      )
      for (const item of items) {
        projects.set(item.id, {
          id: item.id,
          name: item.name ?? undefined,
          worktree: item.worktree,
        })
      }
    }

    for (const row of rows) {
      const project = projects.get(row.project_id) ?? null
      yield { ...fromRow(row), project }
    }
  }

  export const children = fn(Identifier.schema("session"), async (parentID) => {
    const project = Instance.project
    const a = actor()
    const conditions: SQL[] = [eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)]
    if (a) {
      conditions.push(eq(SessionTable.user_id, a.user_id))
    }
    const rows = await Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(Identifier.schema("session"), async (sessionID) => {
    const row = await assertWritable(sessionID)
    const session = fromRow(row)
    for (const child of await children(sessionID)) {
      await remove(child.id)
    }
    SessionPrompt.cancel(sessionID)
    const { SessionSync } = await import("./sync")
    await SessionSync.cancel(sessionID)
    await unshare(sessionID).catch(() => {})
    if (row.workspace_directory) {
      await removeWorkspace({
        projectID: row.project_id,
        directory: row.workspace_directory,
      })
    }
    await Database.use(async (db) => {
      await db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      Database.effect(() =>
        Bus.publish(Event.Deleted, {
          info: session,
        }),
      )
    })
    return true
  })

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    await assertWritable(msg.sessionID)
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    await Database.use(async (db) => {
      await db
        .insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(MessageV2.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      // CASCADE delete handles parts automatically
      await Database.use(async (db) => {
        await db
          .delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(MessageV2.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part"),
    }),
    async (input) => {
      await assertWritable(input.sessionID)
      await Database.use(async (db) => {
        await db
          .delete(PartTable)
          .where(and(eq(PartTable.id, input.partID), eq(PartTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(MessageV2.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = MessageV2.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    await assertWritable(part.sessionID)
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    await Database.use(async (db) => {
      await db
        .insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(MessageV2.Event.PartUpdated, {
          part,
        }),
      )
    })
    if (part.type === "step-finish") {
      void TokenUsageService.recordStepFinish({ part, persistedAt: time }).catch((error) => {
        log.warn("failed to record token usage on step-finish", {
          error,
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
        })
      })
    }
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      partID: z.string(),
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(MessageV2.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like TpCode's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
