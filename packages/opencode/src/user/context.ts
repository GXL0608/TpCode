import { Project } from "@/project/project"
import { ProjectTable } from "@/project/project.sql"
import { Database, and, eq, inArray } from "@/storage/db"
import { TpRoleTable, TpUserRoleTable } from "./role.sql"
import { TpProjectRoleAccessTable } from "./project-role-access.sql"
import { TpProjectUserAccessTable } from "./project-user-access.sql"
import { TpUserProjectStateTable } from "./user-project-state.sql"
import { TpUserTable } from "./user.sql"

function unique(input: string[]) {
  return [...new Set(input)]
}

async function userRoles(user_id: string) {
  const links = await Database.use((db) => db.select().from(TpUserRoleTable).where(eq(TpUserRoleTable.user_id, user_id)).all())
  if (links.length === 0) return { ids: [] as string[], codes: [] as string[] }
  const ids = unique(links.map((item) => item.role_id))
  const rows = await Database.use((db) => db.select().from(TpRoleTable).where(inArray(TpRoleTable.id, ids)).all())
  return { ids, codes: rows.map((item) => item.code) }
}

export namespace AccountContextService {
  export async function projectIDs(user_id: string) {
    const roles = await userRoles(user_id)
    const roleProjects =
      roles.ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select({ project_id: TpProjectRoleAccessTable.project_id })
              .from(TpProjectRoleAccessTable)
              .where(inArray(TpProjectRoleAccessTable.role_id, roles.ids))
              .all(),
          )
    const userProjects = await Database.use((db) =>
      db.select().from(TpProjectUserAccessTable).where(eq(TpProjectUserAccessTable.user_id, user_id)).all(),
    )
    const deny = new Set(userProjects.filter((item) => item.mode === "deny").map((item) => item.project_id))
    const allow = userProjects.filter((item) => item.mode === "allow").map((item) => item.project_id)
    return unique([...roleProjects.map((item) => item.project_id), ...allow]).filter((item) => !deny.has(item))
  }

  export async function canAccessProject(input: { user_id: string; project_id: string }) {
    const ids = await projectIDs(input.user_id)
    return ids.includes(input.project_id)
  }

  export async function listProjects(input: { user_id: string; context_project_id?: string }) {
    const ids = await projectIDs(input.user_id)
    const rows =
      ids.length === 0
        ? []
        : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, ids)).all())
    const state = await Database.use((db) =>
      db.select().from(TpUserProjectStateTable).where(eq(TpUserProjectStateTable.user_id, input.user_id)).get(),
    )
    return {
      current_project_id: input.context_project_id,
      last_project_id: state?.last_project_id ?? undefined,
      projects: rows
        .map((item) => Project.fromRow(item))
        .sort((a, b) => b.time.updated - a.time.updated)
        .map((item) => ({
          id: item.id,
          name: item.name,
          worktree: item.worktree,
          vcs: item.vcs,
          selected: item.id === input.context_project_id,
          last_selected: item.id === state?.last_project_id,
        })),
    }
  }

  export async function remember(input: { user_id: string; project_id: string }) {
    await Database.use(async (db) => {
      await db.insert(TpUserProjectStateTable)
        .values({
          user_id: input.user_id,
          last_project_id: input.project_id,
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: TpUserProjectStateTable.user_id,
          set: {
            last_project_id: input.project_id,
            time_updated: Date.now(),
          },
        })
        .run()
    })
  }

  export async function lastProject(user_id: string) {
    const row = await Database.use((db) =>
      db.select().from(TpUserProjectStateTable).where(eq(TpUserProjectStateTable.user_id, user_id)).get(),
    )
    return row?.last_project_id ?? undefined
  }

  export async function listRoleAccess(input?: { project_id?: string }) {
    const rows = await Database.use((db) => {
      if (!input?.project_id) {
        return db.select().from(TpProjectRoleAccessTable).all()
      }
      return db
        .select()
        .from(TpProjectRoleAccessTable)
        .where(eq(TpProjectRoleAccessTable.project_id, input.project_id))
        .all()
    })
    const roleIDs = unique(rows.map((item) => item.role_id))
    const roles =
      roleIDs.length === 0
        ? []
        : await Database.use((db) => db.select().from(TpRoleTable).where(inArray(TpRoleTable.id, roleIDs)).all())
    const roleByID = new Map(roles.map((item) => [item.id, item]))
    return rows.map((item) => ({
      project_id: item.project_id,
      role_id: item.role_id,
      role_code: roleByID.get(item.role_id)?.code,
      role_name: roleByID.get(item.role_id)?.name,
      time_created: item.time_created,
    }))
  }

  export async function setRoleAccess(input: { project_id: string; role_codes: string[] }) {
    const project = await Database.use((db) => db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, input.project_id)).get())
    if (!project) return { ok: false as const, code: "project_missing" }
    const role_codes = unique(input.role_codes)
    const roles =
      role_codes.length === 0
        ? []
        : await Database.use((db) => db.select().from(TpRoleTable).where(inArray(TpRoleTable.code, role_codes)).all())
    if (roles.length !== role_codes.length) return { ok: false as const, code: "role_missing" }
    await Database.use(async (db) => {
      await db.delete(TpProjectRoleAccessTable).where(eq(TpProjectRoleAccessTable.project_id, input.project_id)).run()
      if (roles.length > 0) {
        await db.insert(TpProjectRoleAccessTable)
          .values(
            roles.map((item) => ({
              project_id: input.project_id,
              role_id: item.id,
              time_created: Date.now(),
            })),
          )
          .run()
      }
    })
    return { ok: true as const }
  }

  export async function listUserAccess(input?: { project_id?: string; user_id?: string }) {
    const rows = await Database.use((db) => {
      if (input?.project_id && input?.user_id) {
        return db
          .select()
          .from(TpProjectUserAccessTable)
          .where(and(eq(TpProjectUserAccessTable.project_id, input.project_id), eq(TpProjectUserAccessTable.user_id, input.user_id)))
          .all()
      }
      if (input?.project_id) {
        return db
          .select()
          .from(TpProjectUserAccessTable)
          .where(eq(TpProjectUserAccessTable.project_id, input.project_id))
          .all()
      }
      if (input?.user_id) {
        return db
          .select()
          .from(TpProjectUserAccessTable)
          .where(eq(TpProjectUserAccessTable.user_id, input.user_id))
          .all()
      }
      return db.select().from(TpProjectUserAccessTable).all()
    })
    const userIDs = unique(rows.map((item) => item.user_id))
    const users =
      userIDs.length === 0
        ? []
        : await Database.use((db) => db.select().from(TpUserTable).where(inArray(TpUserTable.id, userIDs)).all())
    const userByID = new Map(users.map((item) => [item.id, item]))
    return rows.map((item) => ({
      project_id: item.project_id,
      user_id: item.user_id,
      username: userByID.get(item.user_id)?.username,
      display_name: userByID.get(item.user_id)?.display_name,
      mode: item.mode,
      time_created: item.time_created,
    }))
  }

  export async function setUserAccess(input: { project_id: string; user_id: string; mode: "allow" | "deny" | "remove" }) {
    const project = await Database.use((db) => db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, input.project_id)).get())
    if (!project) return { ok: false as const, code: "project_missing" }
    const user = await Database.use((db) => db.select({ id: TpUserTable.id }).from(TpUserTable).where(eq(TpUserTable.id, input.user_id)).get())
    if (!user) return { ok: false as const, code: "user_missing" }
    if (input.mode === "remove") {
      await Database.use((db) =>
        db
          .delete(TpProjectUserAccessTable)
          .where(and(eq(TpProjectUserAccessTable.project_id, input.project_id), eq(TpProjectUserAccessTable.user_id, input.user_id)))
          .run(),
      )
      return { ok: true as const }
    }
    await Database.use(async (db) => {
      await db.insert(TpProjectUserAccessTable)
        .values({
          project_id: input.project_id,
          user_id: input.user_id,
          mode: input.mode,
          time_created: Date.now(),
        })
        .onConflictDoUpdate({
          target: [TpProjectUserAccessTable.project_id, TpProjectUserAccessTable.user_id],
          set: {
            mode: input.mode,
            time_created: Date.now(),
          },
        })
        .run()
    })
    return { ok: true as const }
  }

  export async function roleProjects(role_code: string) {
    const role = await Database.use((db) => db.select().from(TpRoleTable).where(eq(TpRoleTable.code, role_code)).get())
    if (!role) return { ok: false as const, code: "role_missing" }
    const links = await Database.use((db) =>
      db.select().from(TpProjectRoleAccessTable).where(eq(TpProjectRoleAccessTable.role_id, role.id)).all(),
    )
    const project_ids = unique(links.map((item) => item.project_id))
    const projects =
      project_ids.length === 0
        ? []
        : await Database.use((db) => db.select().from(ProjectTable).where(inArray(ProjectTable.id, project_ids)).all())
    return {
      ok: true as const,
      role_code,
      project_ids,
      projects: projects.map((item) => ({
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
        vcs: item.vcs ?? undefined,
      })),
    }
  }

  export async function setRoleProjects(input: { role_code: string; project_ids: string[] }) {
    const role = await Database.use((db) => db.select().from(TpRoleTable).where(eq(TpRoleTable.code, input.role_code)).get())
    if (!role) return { ok: false as const, code: "role_missing" }
    const project_ids = unique(input.project_ids)
    const projects =
      project_ids.length === 0
        ? []
        : await Database.use((db) => db.select({ id: ProjectTable.id }).from(ProjectTable).where(inArray(ProjectTable.id, project_ids)).all())
    if (projects.length !== project_ids.length) return { ok: false as const, code: "project_missing" }
    await Database.use(async (db) => {
      await db.delete(TpProjectRoleAccessTable).where(eq(TpProjectRoleAccessTable.role_id, role.id)).run()
      if (project_ids.length > 0) {
        await db.insert(TpProjectRoleAccessTable)
          .values(
            project_ids.map((project_id) => ({
              project_id,
              role_id: role.id,
              time_created: Date.now(),
            })),
          )
          .run()
      }
    })
    return { ok: true as const }
  }
}
