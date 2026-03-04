import { and, Database, desc, eq, inArray, isNull, like, or, sql, type SQL } from "@/storage/db"
import { TpOrganizationTable } from "./organization.sql"
import { TpDepartmentTable } from "./department.sql"
import { TpUserTable } from "./user.sql"
import { TpRoleTable, TpUserRoleTable } from "./role.sql"
import { TpPermissionTable, TpRolePermissionTable } from "./permission.sql"
import { TpSessionTokenTable } from "./token.sql"
import { TpPasswordResetTable } from "./password-reset.sql"
import { TpAuditLogTable } from "./audit-log.sql"
import { UserPassword } from "./password"
import { UserPhone } from "./phone"
import { UserJwt } from "./jwt"
import { createHash, randomInt } from "crypto"
import { ulid } from "ulid"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { AccountContextService } from "./context"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"

type UserRow = typeof TpUserTable.$inferSelect
const log = Log.create({ service: "user" })
const AUTH_CACHE_TTL_MS = 300_000
const AUTH_CACHE_MAX_SIZE = 20_000
const AUTH_CACHE_SWEEP_BATCH = 256

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function id(input: string) {
  return "id_" + hash(input).slice(0, 24)
}

function roles() {
  return [
    { code: "super_admin", name: "超级管理员", scope: "system" },
    { code: "dev_lead", name: "研发负责人", scope: "system" },
    { code: "developer", name: "研发工程师", scope: "system" },
    { code: "ops", name: "运维工程师", scope: "system" },
    { code: "pm", name: "项目经理", scope: "system" },
    { code: "value_ops", name: "价值运营", scope: "system" },
    { code: "hospital_admin", name: "医院管理员", scope: "org" },
    { code: "dept_director", name: "科室主任", scope: "org" },
    { code: "hospital_user", name: "医院用户", scope: "org" },
    { code: "dean", name: "院长", scope: "org" },
  ]
}

function permissions() {
  return [
    { code: "user:manage", name: "用户管理", group_name: "system" },
    { code: "org:manage", name: "组织管理", group_name: "system" },
    { code: "role:manage", name: "角色管理", group_name: "system" },
    { code: "session:create", name: "创建会话", group_name: "session" },
    { code: "session:view_own", name: "查看本人会话", group_name: "session" },
    { code: "session:view_dept", name: "查看本科室会话", group_name: "session" },
    { code: "session:view_org", name: "查看本机构会话", group_name: "session" },
    { code: "session:view_all", name: "查看全部会话", group_name: "session" },
    { code: "session:update_any", name: "管理全部会话", group_name: "session" },
    { code: "code:generate", name: "生成代码", group_name: "code" },
    { code: "code:review", name: "代码审查", group_name: "code" },
    { code: "code:deploy", name: "部署代码", group_name: "code" },
    { code: "prototype:view", name: "查看原型", group_name: "prototype" },
    { code: "prototype:approve", name: "审批原型", group_name: "prototype" },
    { code: "file:browse", name: "浏览文件", group_name: "file" },
    { code: "agent:use_docs", name: "使用 Docs 智能体", group_name: "agent" },
    { code: "agent:use_build", name: "使用 Build 智能体", group_name: "agent" },
    { code: "agent:use_plan", name: "使用 Plan 智能体", group_name: "agent" },
    { code: "provider:config_own", name: "配置个人模型密钥", group_name: "provider" },
    { code: "provider:config_global", name: "配置全局模型密钥", group_name: "provider" },
    { code: "provider:config_user", name: "配置用户模型密钥", group_name: "provider" },
    { code: "ui:settings.providers:view", name: "查看供应商设置页", group_name: "ui" },
    { code: "ui:settings.models:view", name: "查看模型设置页", group_name: "ui" },
    { code: "audit:view", name: "查看审计日志", group_name: "audit" },
  ]
}

const rolePerm = {
  super_admin: [
    "user:manage",
    "org:manage",
    "role:manage",
    "session:create",
    "session:view_own",
    "session:view_dept",
    "session:view_org",
    "session:view_all",
    "session:update_any",
    "code:generate",
    "code:review",
    "code:deploy",
    "prototype:view",
    "prototype:approve",
    "file:browse",
    "agent:use_docs",
    "agent:use_build",
    "agent:use_plan",
    "provider:config_global",
    "provider:config_user",
    "ui:settings.providers:view",
    "ui:settings.models:view",
    "audit:view",
  ],
  dev_lead: [
    "session:create",
    "session:view_own",
    "session:view_dept",
    "session:view_org",
    "session:view_all",
    "session:update_any",
    "code:generate",
    "code:review",
    "code:deploy",
    "prototype:view",
    "prototype:approve",
    "file:browse",
    "agent:use_plan",
  ],
  developer: ["session:create", "session:view_own", "code:generate", "prototype:view", "file:browse", "agent:use_plan"],
  ops: ["session:create", "session:view_own", "code:deploy", "prototype:view", "file:browse", "agent:use_plan"],
  pm: [
    "session:create",
    "session:view_own",
    "session:view_dept",
    "session:view_all",
    "prototype:view",
    "prototype:approve",
    "agent:use_plan",
  ],
  value_ops: ["session:create", "session:view_own", "session:view_all", "prototype:view", "agent:use_plan"],
  hospital_admin: [
    "session:create",
    "session:view_own",
    "session:view_dept",
    "session:view_org",
    "prototype:view",
    "agent:use_plan",
  ],
  dept_director: [
    "session:create",
    "session:view_own",
    "session:view_dept",
    "prototype:view",
    "prototype:approve",
    "agent:use_plan",
  ],
  hospital_user: ["session:create", "session:view_own", "prototype:view", "agent:use_plan"],
  dean: [
    "session:view_own",
    "session:view_org",
    "session:view_all",
    "prototype:view",
    "prototype:approve",
    "agent:use_plan",
  ],
} as const

const roleNameMap = {
  super_admin: "超级管理员",
  dev_lead: "研发负责人",
  developer: "研发工程师",
  ops: "运维工程师",
  pm: "项目经理",
  value_ops: "价值运营",
  hospital_admin: "医院管理员",
  dept_director: "科室主任",
  hospital_user: "医院用户",
  dean: "院长",
} as const

const permissionNameMap = {
  "user:manage": "用户管理",
  "org:manage": "组织管理",
  "role:manage": "角色管理",
  "session:create": "创建会话",
  "session:view_own": "查看本人会话",
  "session:view_dept": "查看本科室会话",
  "session:view_org": "查看本机构会话",
  "session:view_all": "查看全部会话",
  "session:update_any": "管理全部会话",
  "code:generate": "生成代码",
  "code:review": "代码审查",
  "code:deploy": "部署代码",
  "prototype:view": "查看原型",
  "prototype:approve": "审批原型",
  "file:browse": "浏览文件",
  "agent:use_docs": "使用 Docs 智能体",
  "agent:use_build": "使用 Build 智能体",
  "agent:use_plan": "使用 Plan 智能体",
  "provider:config_own": "配置个人模型密钥",
  "provider:config_global": "配置全局模型密钥",
  "provider:config_user": "配置用户模型密钥",
  "ui:settings.providers:view": "查看供应商设置页",
  "ui:settings.models:view": "查看模型设置页",
  "audit:view": "查看审计日志",
} as const

function roleName(code: string) {
  return roleNameMap[code as keyof typeof roleNameMap] ?? code
}

function permissionName(code: string) {
  return permissionNameMap[code as keyof typeof permissionNameMap] ?? code
}

function roleCodeValid(code: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(code)
}

function profile(input: { user: UserRow; roles: string[]; permissions: string[]; context_project_id?: string }) {
  return {
    id: input.user.id,
    username: input.user.username,
    display_name: input.user.display_name,
    account_type: input.user.account_type,
    org_id: input.user.org_id,
    department_id: input.user.department_id ?? undefined,
    force_password_reset: input.user.force_password_reset,
    context_project_id: input.context_project_id,
    roles: input.roles,
    permissions: input.permissions,
  }
}

function registerMode() {
  const mode = (Flag.TPCODE_REGISTER_MODE ?? "open").toLowerCase()
  if (mode === "closed") return "closed"
  return "open"
}

type AuthorizeDetailOk = {
  ok: true
  user: ReturnType<typeof profile>
  sid: string
  sub: string
}

type AuthorizeDetail =
  | AuthorizeDetailOk
  | {
      ok: false
      reason: "jwt_invalid" | "session_missing" | "session_expired" | "user_inactive" | "user_locked"
      sid?: string
      sub?: string
      locked_until?: number
    }

const authCacheByTokenHash = new Map<
  string,
  {
    expiresAt: number
    detail: AuthorizeDetailOk
    userID: string
  }
>()
const authCacheTokenSetByUserID = new Map<string, Set<string>>()
let ensureSeedPromise: Promise<void> | undefined

function invalidateByTokenHash(tokenHash: string) {
  const existing = authCacheByTokenHash.get(tokenHash)
  if (!existing) return
  authCacheByTokenHash.delete(tokenHash)
  const tokens = authCacheTokenSetByUserID.get(existing.userID)
  if (!tokens) return
  tokens.delete(tokenHash)
  if (tokens.size === 0) authCacheTokenSetByUserID.delete(existing.userID)
}

function invalidateByUserID(userID: string) {
  const tokens = authCacheTokenSetByUserID.get(userID)
  if (!tokens || tokens.size === 0) return
  for (const tokenHash of tokens) {
    authCacheByTokenHash.delete(tokenHash)
  }
  authCacheTokenSetByUserID.delete(userID)
}

function sweepExpiredAuthCache(now: number) {
  let checked = 0
  for (const [tokenHash, cached] of authCacheByTokenHash) {
    if (checked >= AUTH_CACHE_SWEEP_BATCH) break
    checked += 1
    if (cached.expiresAt > now) continue
    invalidateByTokenHash(tokenHash)
  }
}

function enforceAuthCacheLimit() {
  while (authCacheByTokenHash.size > AUTH_CACHE_MAX_SIZE) {
    const oldest = authCacheByTokenHash.keys().next().value
    if (typeof oldest !== "string") break
    invalidateByTokenHash(oldest)
  }
}

function cacheAuthorizeDetail(input: { tokenHash: string; userID: string; detail: AuthorizeDetailOk; expiresAt: number }) {
  if (authCacheByTokenHash.has(input.tokenHash)) {
    invalidateByTokenHash(input.tokenHash)
  }
  authCacheByTokenHash.set(input.tokenHash, {
    expiresAt: input.expiresAt,
    detail: input.detail,
    userID: input.userID,
  })
  let tokens = authCacheTokenSetByUserID.get(input.userID)
  if (!tokens) {
    tokens = new Set()
    authCacheTokenSetByUserID.set(input.userID, tokens)
  }
  tokens.add(input.tokenHash)
  enforceAuthCacheLimit()
}

export namespace UserService {
  export function ensureSeedOnce() {
    if (ensureSeedPromise) return ensureSeedPromise
    ensureSeedPromise = ensureSeed().catch((error) => {
      ensureSeedPromise = undefined
      throw error
    })
    return ensureSeedPromise
  }

  export async function ensureSeed() {
    const p = permissions()
    const r = roles()
    await Database.use(async (db) => {
      await db.insert(TpOrganizationTable)
        .values({
          id: "org_tp_internal",
          name: "Tp Internal",
          code: "tp_internal",
          org_type: "internal",
        })
        .onConflictDoNothing()
        .run()
      await db.insert(TpDepartmentTable)
        .values({
          id: "dept_tp_rnd",
          org_id: "org_tp_internal",
          name: "R&D",
          code: "rnd",
        })
        .onConflictDoNothing()
        .run()
      await db.insert(TpPermissionTable)
        .values(
          p.map((item) => ({
            id: id("perm_" + item.code),
            code: item.code,
            name: item.name,
            group_name: item.group_name,
          })),
        )
        .onConflictDoNothing()
        .run()
      await db.insert(TpRoleTable)
        .values(
          r.map((item) => ({
            id: id("role_" + item.code),
            code: item.code,
            name: item.name,
            scope: item.scope,
          })),
        )
        .onConflictDoNothing()
        .run()
      await db.insert(TpRolePermissionTable)
        .values(
          r.flatMap((item) =>
            (rolePerm[item.code as keyof typeof rolePerm] ?? []).map((perm) => ({
              role_id: id("role_" + item.code),
              permission_id: id("perm_" + perm),
            })),
          ),
        )
        .onConflictDoNothing()
        .run()
    })

    const user = await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.username, "admin")).get())
    if (!user) {
      const pass = Flag.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026"
      const password_hash = await UserPassword.hash(pass)
      await Database.use(async (db) => {
        await db.insert(TpUserTable)
          .values({
            id: "user_tp_admin",
            username: "admin",
            password_hash,
            display_name: "System Admin",
            account_type: "internal",
            org_id: "org_tp_internal",
            department_id: "dept_tp_rnd",
            force_password_reset: true,
            external_source: "tpcode",
          })
          .onConflictDoNothing()
          .run()
      })
    }
    await Database.use(async (db) => {
      await db.insert(TpUserRoleTable)
        .values({
          user_id: "user_tp_admin",
          role_id: id("role_super_admin"),
        })
        .onConflictDoNothing()
        .run()
    })
  }

  export function parseBearer(input?: string) {
    if (!input) return
    if (!input.startsWith("Bearer ")) return
    return input.slice("Bearer ".length).trim()
  }

  export function tokenHash(input: string) {
    return hash(input)
  }

  export async function userByID(user_id: string) {
    return await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.id, user_id)).get())
  }

  export async function userByUsername(username: string) {
    return await Database.use((db) => db.select().from(TpUserTable).where(eq(TpUserTable.username, username)).get())
  }

  export async function orgByCode(code: string) {
    return await Database.use((db) => db.select().from(TpOrganizationTable).where(eq(TpOrganizationTable.code, code)).get())
  }

  export async function rolesByUser(user_id: string) {
    const links = await Database.use((db) => db.select().from(TpUserRoleTable).where(eq(TpUserRoleTable.user_id, user_id)).all())
    const ids = [...new Set(links.map((item) => item.role_id))]
    if (ids.length === 0) return [] as string[]
    const rows = await Database.use((db) => db.select().from(TpRoleTable).where(inArray(TpRoleTable.id, ids)).all())
    return rows.map((item) => item.code)
  }

  export async function permissionsByUser(user_id: string) {
    const links = await Database.use((db) => db.select().from(TpUserRoleTable).where(eq(TpUserRoleTable.user_id, user_id)).all())
    const role_ids = [...new Set(links.map((item) => item.role_id))]
    if (role_ids.length === 0) return [] as string[]
    const permLinks = await Database.use((db) =>
      db.select().from(TpRolePermissionTable).where(inArray(TpRolePermissionTable.role_id, role_ids)).all(),
    )
    const perm_ids = [...new Set(permLinks.map((item) => item.permission_id))]
    if (perm_ids.length === 0) return [] as string[]
    const rows = await Database.use((db) => db.select().from(TpPermissionTable).where(inArray(TpPermissionTable.id, perm_ids)).all())
    return rows.map((item) => item.code)
  }

  export async function audit(input: {
    actor_user_id?: string
    action: string
    target_type: string
    target_id?: string
    result: "success" | "failed" | "blocked"
    detail_json?: Record<string, unknown>
    ip?: string
    user_agent?: string
  }) {
    await Database.use(async (db) => {
      await db.insert(TpAuditLogTable)
        .values({
          id: ulid(),
          actor_user_id: input.actor_user_id,
          action: input.action,
          target_type: input.target_type,
          target_id: input.target_id,
          result: input.result,
          detail_json: input.detail_json,
          ip: input.ip,
          user_agent: input.user_agent,
        })
        .run()
    })
  }

  type AuditInput = Parameters<typeof audit>[0]
  export function auditLater(input: AuditInput) {
    void audit(input).catch((error) => {
      log.error("failed to write audit log", {
        error,
        action: input.action,
        target_type: input.target_type,
        target_id: input.target_id,
        actor_user_id: input.actor_user_id,
      })
    })
  }

  export async function register(input: {
    username: string
    password: string
    display_name?: string
    email?: string
    phone: string
    ip?: string
    user_agent?: string
  }) {
    const mode = registerMode()
    if (mode === "closed") return { ok: false as const, code: "register_closed" }
    const phone = UserPhone.normalize(input.phone)
    if (!phone) return { ok: false as const, code: "phone_invalid" }
    if (!UserPassword.valid(input.password)) return { ok: false as const, code: "password_invalid" }
    const exists = await userByUsername(input.username)
    if (exists) return { ok: false as const, code: "username_exists" }

    const org = await orgByCode("tp_internal")
    if (!org) return { ok: false as const, code: "org_missing" }

    const account_type = "internal" as const
    const user_id = ulid()
    const password_hash = await UserPassword.hash(input.password)
    await Database.use(async (db) => {
      await db.insert(TpUserTable)
        .values({
          id: user_id,
          username: input.username,
          password_hash,
          display_name: input.display_name ?? input.username,
          email: input.email,
          phone,
          account_type,
          org_id: org.id,
          department_id: undefined,
          force_password_reset: false,
          external_source: "tpcode",
        })
        .run()
      const role = "developer"
      await db.insert(TpUserRoleTable)
        .values({
          user_id,
          role_id: id("role_" + role),
        })
        .run()
    })
    auditLater({
      actor_user_id: user_id,
      action: "account.register",
      target_type: "tp_user",
      target_id: user_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  async function issueTokens(input: {
    user_id: string
    context_project_id?: string
    ip?: string
    user_agent?: string
  }) {
    const access_id = ulid()
    const refresh_id = ulid()
    const access = await UserJwt.issueAccess({
      user_id: input.user_id,
      session_id: access_id,
      context_project_id: input.context_project_id,
    })
    const refresh = await UserJwt.issueRefresh({
      user_id: input.user_id,
      session_id: refresh_id,
      context_project_id: input.context_project_id,
    })
    await Database.use(async (db) => {
      await db.insert(TpSessionTokenTable)
        .values([
          {
            id: access_id,
            user_id: input.user_id,
            token_hash: tokenHash(access.token),
            token_type: "access",
            context_project_id: input.context_project_id,
            expires_at: access.exp,
            ip: input.ip,
            user_agent: input.user_agent,
          },
          {
            id: refresh_id,
            user_id: input.user_id,
            token_hash: tokenHash(refresh.token),
            token_type: "refresh",
            context_project_id: input.context_project_id,
            expires_at: refresh.exp,
            ip: input.ip,
            user_agent: input.user_agent,
          },
        ])
        .run()
    })
    return {
      access_token: access.token,
      refresh_token: refresh.token,
      access_expires_at: access.exp,
      refresh_expires_at: refresh.exp,
    }
  }

  export async function login(input: { username: string; password: string; ip?: string; user_agent?: string }) {
    const user = await userByUsername(input.username)
    if (!user) return { ok: false as const, code: "invalid_credentials" }
    if (user.status !== "active") return { ok: false as const, code: "invalid_credentials" }
    const now = Date.now()
    const valid = await UserPassword.verify(input.password, user.password_hash)
    if (!valid) {
      if (user.locked_until && user.locked_until > now) return { ok: false as const, code: "user_locked" }
      const failed = user.failed_login_count + 1
      const locked = failed >= 5 ? now + 15 * 60 * 1000 : null
      await Database.use(async (db) => {
        await db.update(TpUserTable)
          .set({
            failed_login_count: failed,
            locked_until: locked,
          })
          .where(eq(TpUserTable.id, user.id))
          .run()
      })
      auditLater({
        actor_user_id: user.id,
        action: "account.login",
        target_type: "tp_user",
        target_id: user.id,
        result: "failed",
        ip: input.ip,
        user_agent: input.user_agent,
      })
      return { ok: false as const, code: "invalid_credentials" }
    }
    const roles = await rolesByUser(user.id)
    const permissions = await permissionsByUser(user.id)
    const token = await issueTokens({
      user_id: user.id,
      ip: input.ip,
      user_agent: input.user_agent,
    })
    await Database.use(async (db) => {
      await db.update(TpUserTable)
        .set({
          failed_login_count: 0,
          locked_until: null,
          last_login_at: Date.now(),
          last_login_ip: input.ip,
        })
        .where(eq(TpUserTable.id, user.id))
        .run()
    })
    auditLater({
      actor_user_id: user.id,
      action: "account.login",
      target_type: "tp_user",
      target_id: user.id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      ...token,
      user: profile({ user, roles, permissions }),
    }
  }

  export async function refresh(input: { refresh_token: string; ip?: string; user_agent?: string }) {
    const parsed = await UserJwt.verifyRefresh(input.refresh_token)
    if (!parsed) return { ok: false as const, code: "token_invalid" }
    const now = Date.now()
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpSessionTokenTable)
        .where(
          and(
            eq(TpSessionTokenTable.id, parsed.sid),
            eq(TpSessionTokenTable.user_id, parsed.sub),
            eq(TpSessionTokenTable.token_hash, tokenHash(input.refresh_token)),
            eq(TpSessionTokenTable.token_type, "refresh"),
            isNull(TpSessionTokenTable.revoked_at),
          ),
        )
        .get(),
    )
    if (!row) return { ok: false as const, code: "token_invalid" }
    if (row.expires_at <= now) return { ok: false as const, code: "token_expired" }
    const user = await userByID(parsed.sub)
    if (!user || user.status !== "active") return { ok: false as const, code: "user_invalid" }
    const roles = await rolesByUser(user.id)
    const permissions = await permissionsByUser(user.id)
    await Database.use((db) =>
      db
        .update(TpSessionTokenTable)
        .set({ revoked_at: now })
        .where(eq(TpSessionTokenTable.id, row.id))
        .run(),
    )
    const context_project_id = row.context_project_id ?? parsed.pid
    const token = await issueTokens({
      user_id: user.id,
      context_project_id: context_project_id ?? undefined,
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      ...token,
      user: profile({
        user,
        roles,
        permissions,
        context_project_id: context_project_id ?? undefined,
      }),
    }
  }

  export async function changePassword(input: {
    user_id: string
    current_password: string
    new_password: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const valid = await UserPassword.verify(input.current_password, user.password_hash)
    if (!valid) return { ok: false as const, code: "password_invalid" }
    if (!UserPassword.valid(input.new_password)) return { ok: false as const, code: "new_password_invalid" }
    const password_hash = await UserPassword.hash(input.new_password)
    await Database.use((db) =>
      db
        .update(TpUserTable)
        .set({
          password_hash,
          force_password_reset: false,
        })
        .where(eq(TpUserTable.id, input.user_id))
        .run(),
    )
    invalidateByUserID(input.user_id)
    auditLater({
      actor_user_id: input.user_id,
      action: "account.password.change",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function resetUserPassword(input: {
    user_id: string
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const password_hash = await UserPassword.hash("TpCode@2026")
    await Database.use(async (db) => {
      await db.update(TpUserTable)
        .set({
          password_hash,
          force_password_reset: false,
          failed_login_count: 0,
          locked_until: null,
          time_updated: Date.now(),
        })
        .where(eq(TpUserTable.id, input.user_id))
        .run()
      await db.update(TpSessionTokenTable)
        .set({ revoked_at: Date.now() })
        .where(and(eq(TpSessionTokenTable.user_id, input.user_id), isNull(TpSessionTokenTable.revoked_at)))
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.user.password.reset",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function revokeToken(input: { token: string }) {
    const hashed = tokenHash(input.token)
    await Database.use((db) =>
      db
        .update(TpSessionTokenTable)
        .set({ revoked_at: Date.now() })
        .where(eq(TpSessionTokenTable.token_hash, hashed))
        .run(),
    )
    invalidateByTokenHash(hashed)
  }

  export async function revokeAll(input: { user_id: string }) {
    await Database.use((db) =>
      db
        .update(TpSessionTokenTable)
        .set({ revoked_at: Date.now() })
        .where(and(eq(TpSessionTokenTable.user_id, input.user_id), isNull(TpSessionTokenTable.revoked_at)))
        .run(),
    )
    invalidateByUserID(input.user_id)
  }

  export async function authorizeDetail(token: string): Promise<AuthorizeDetail> {
    const parsed = await UserJwt.verifyAccess(token)
    if (!parsed) return { ok: false, reason: "jwt_invalid" }
    const now = Date.now()
    sweepExpiredAuthCache(now)
    const hashed = tokenHash(token)
    const cached = authCacheByTokenHash.get(hashed)
    if (cached && cached.expiresAt > now) {
      return cached.detail
    }
    if (cached) {
      invalidateByTokenHash(hashed)
    }
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpSessionTokenTable)
        .where(
          and(
            eq(TpSessionTokenTable.id, parsed.sid),
            eq(TpSessionTokenTable.user_id, parsed.sub),
            eq(TpSessionTokenTable.token_hash, hashed),
            eq(TpSessionTokenTable.token_type, "access"),
            isNull(TpSessionTokenTable.revoked_at),
          ),
        )
        .get(),
    )
    if (!row) return { ok: false, reason: "session_missing", sid: parsed.sid, sub: parsed.sub }
    if (row.expires_at <= now) return { ok: false, reason: "session_expired", sid: parsed.sid, sub: parsed.sub }
    const user = await userByID(parsed.sub)
    if (!user || user.status !== "active") return { ok: false, reason: "user_inactive", sid: parsed.sid, sub: parsed.sub }
    if (user.locked_until && user.locked_until > now) {
      return {
        ok: false,
        reason: "user_locked",
        sid: parsed.sid,
        sub: parsed.sub,
        locked_until: user.locked_until,
      }
    }
    const roles = await rolesByUser(user.id)
    const permissions = await permissionsByUser(user.id)
    const detail: AuthorizeDetailOk = {
      ok: true,
      user: profile({
        user,
        roles,
        permissions,
        context_project_id: row.context_project_id ?? parsed.pid,
      }),
      sid: parsed.sid,
      sub: parsed.sub,
    }
    const expiresAt = Math.min(now + AUTH_CACHE_TTL_MS, parsed.exp * 1000)
    if (expiresAt > now) {
      cacheAuthorizeDetail({
        tokenHash: hashed,
        userID: user.id,
        detail,
        expiresAt,
      })
    }
    return detail
  }

  export async function authorize(token: string) {
    const result = await authorizeDetail(token)
    if (!result.ok) return
    return result.user
  }

  export async function me(input: { user_id: string; context_project_id?: string }) {
    const user_id = input.user_id
    const user = await userByID(user_id)
    if (!user) return
    const roles = await rolesByUser(user.id)
    const permissions = await permissionsByUser(user.id)
    return profile({
      user,
      roles,
      permissions,
      context_project_id: input.context_project_id,
    })
  }

  export async function selectContext(input: { user_id: string; project_id: string; ip?: string; user_agent?: string }) {
    const user = await userByID(input.user_id)
    if (!user || user.status !== "active") return { ok: false as const, code: "user_invalid" }
    const allowed = await AccountContextService.canAccessProject({ user_id: input.user_id, project_id: input.project_id })
    if (!allowed) return { ok: false as const, code: "project_forbidden" }
    const project = await Project.get(input.project_id)
    if (!project || !(await Filesystem.isDir(project.worktree))) return { ok: false as const, code: "project_missing" }
    await revokeAll({ user_id: input.user_id })
    await AccountContextService.remember({ user_id: input.user_id, project_id: input.project_id })
    const roles = await rolesByUser(input.user_id)
    const permissions = await permissionsByUser(input.user_id)
    const token = await issueTokens({
      user_id: input.user_id,
      context_project_id: input.project_id,
      ip: input.ip,
      user_agent: input.user_agent,
    })
    auditLater({
      actor_user_id: input.user_id,
      action: "account.context.select",
      target_type: "project",
      target_id: input.project_id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      ...token,
      user: profile({
        user,
        roles,
        permissions,
        context_project_id: input.project_id,
      }),
    }
  }

  export async function meVho(user_id: string) {
    const user = await userByID(user_id)
    if (!user) return
    const phone = user.phone?.trim() ?? ""
    const vho_user_id = user.vho_user_id?.trim() ?? ""
    return {
      user_id: user.id,
      phone: phone || undefined,
      vho_user_id: vho_user_id || undefined,
      phone_bound: !!phone,
      vho_bound: !!vho_user_id,
      bound: !!vho_user_id,
    }
  }

  export async function bindVho(input: {
    user_id: string
    vho_user_id?: string
    phone?: string
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const vho_user_id = input.vho_user_id?.trim() || null
    const phone = input.phone === undefined ? user.phone : input.phone.trim() ? UserPhone.normalize(input.phone) : null
    if (input.phone !== undefined && !!input.phone.trim() && !phone) return { ok: false as const, code: "phone_invalid" }
    await Database.use((db) =>
      db
        .update(TpUserTable)
        .set({
          vho_user_id,
          phone,
          time_updated: Date.now(),
        })
        .where(eq(TpUserTable.id, input.user_id))
        .run(),
    )
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.user.vho.bind",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      detail_json: {
        vho_user_id,
        phone,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function bindMyPhone(input: {
    user_id: string
    phone: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const phone = UserPhone.normalize(input.phone)
    if (!phone) return { ok: false as const, code: "phone_invalid" }
    await Database.use((db) =>
      db
        .update(TpUserTable)
        .set({
          phone,
          time_updated: Date.now(),
        })
        .where(eq(TpUserTable.id, input.user_id))
        .run(),
    )
    auditLater({
      actor_user_id: input.user_id,
      action: "account.me.phone.bind",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      detail_json: { phone },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function resetRequest(input: { username: string; ip?: string; user_agent?: string }) {
    const user = await userByUsername(input.username)
    if (!user) return { ok: true as const }
    const code = String(randomInt(100000, 999999))
    const code_hash = hash(code)
    await Database.use((db) =>
      db.insert(TpPasswordResetTable)
        .values({
          id: ulid(),
          user_id: user.id,
          code_hash,
          channel: "admin",
          expires_at: Date.now() + 10 * 60 * 1000,
        })
        .run(),
    )
    auditLater({
      actor_user_id: user.id,
      action: "account.password.reset.request",
      target_type: "tp_user",
      target_id: user.id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      // Production can swap this for SMS or email delivery.
      reset_code: code,
    }
  }

  export async function resetPassword(input: {
    username: string
    code: string
    new_password: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByUsername(input.username)
    if (!user) return { ok: false as const, code: "user_missing" }
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpPasswordResetTable)
        .where(
          and(
            eq(TpPasswordResetTable.user_id, user.id),
            isNull(TpPasswordResetTable.consumed_at),
          ),
        )
        .all(),
    )
    const row = rows.filter((item) => item.expires_at > Date.now()).sort((a, b) => b.time_created - a.time_created)[0]
    if (!row) return { ok: false as const, code: "reset_missing" }
    if (!UserPassword.valid(input.new_password)) return { ok: false as const, code: "new_password_invalid" }
    const ok = hash(input.code) === row.code_hash
    if (!ok) return { ok: false as const, code: "code_invalid" }
    const password_hash = await UserPassword.hash(input.new_password)
    await Database.use(async (db) => {
      await db.update(TpUserTable)
        .set({
          password_hash,
          force_password_reset: false,
          failed_login_count: 0,
          locked_until: null,
        })
        .where(eq(TpUserTable.id, user.id))
        .run()
      await db.update(TpPasswordResetTable)
        .set({ consumed_at: Date.now() })
        .where(eq(TpPasswordResetTable.id, row.id))
        .run()
      await db.update(TpSessionTokenTable)
        .set({ revoked_at: Date.now() })
        .where(and(eq(TpSessionTokenTable.user_id, user.id), isNull(TpSessionTokenTable.revoked_at)))
        .run()
    })
    invalidateByUserID(user.id)
    auditLater({
      actor_user_id: user.id,
      action: "account.password.reset",
      target_type: "tp_user",
      target_id: user.id,
      result: "success",
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  function defaultRole(account_type: "internal" | "hospital" | "partner") {
    if (account_type === "hospital") return "hospital_user"
    if (account_type === "partner") return "pm"
    return "developer"
  }

  async function roleIDs(codes: string[]) {
    if (codes.length === 0) return [] as string[]
    const rows = await Database.use((db) => db.select().from(TpRoleTable).where(inArray(TpRoleTable.code, codes)).all())
    return rows.map((item) => item.id)
  }

  async function permissionIDs(codes: string[]) {
    if (codes.length === 0) return [] as string[]
    const rows = await Database.use((db) => db.select().from(TpPermissionTable).where(inArray(TpPermissionTable.code, codes)).all())
    return rows.map((item) => item.id)
  }

  export async function listOrganizations() {
    return await Database.use((db) =>
      db
        .select()
        .from(TpOrganizationTable)
        .orderBy(desc(TpOrganizationTable.time_created), desc(TpOrganizationTable.id))
        .all(),
    )
  }

  export async function listDepartments(input?: { org_id?: string }) {
    return await Database.use((db) => {
      if (!input?.org_id) {
        return db
          .select()
          .from(TpDepartmentTable)
          .orderBy(desc(TpDepartmentTable.time_created), desc(TpDepartmentTable.id))
          .all()
      }
      return db
        .select()
        .from(TpDepartmentTable)
        .where(eq(TpDepartmentTable.org_id, input.org_id))
        .orderBy(desc(TpDepartmentTable.time_created), desc(TpDepartmentTable.id))
        .all()
    })
  }

  export async function listPermissions() {
    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpPermissionTable)
        .orderBy(TpPermissionTable.group_name, TpPermissionTable.code)
        .all(),
    )
    return rows.map((item) => ({
      ...item,
      name: permissionName(item.code),
    }))
  }

  export async function listAudit(input?: { actor_user_id?: string; action?: string; limit?: number }) {
    const conditions: SQL[] = []
    if (input?.actor_user_id) conditions.push(eq(TpAuditLogTable.actor_user_id, input.actor_user_id))
    if (input?.action) conditions.push(eq(TpAuditLogTable.action, input.action))
    const limit = input?.limit ?? 100
    return await Database.use((db) => {
      if (conditions.length === 0) {
        return db
          .select()
          .from(TpAuditLogTable)
          .orderBy(desc(TpAuditLogTable.time_created), desc(TpAuditLogTable.id))
          .limit(limit)
          .all()
      }
      return db
        .select()
        .from(TpAuditLogTable)
        .where(and(...conditions))
        .orderBy(desc(TpAuditLogTable.time_created), desc(TpAuditLogTable.id))
        .limit(limit)
        .all()
    })
  }

  async function roleItems(rows: (typeof TpRoleTable.$inferSelect)[]) {
    if (rows.length === 0) return []
    const role_ids = rows.map((item) => item.id)
    const [links, perms, users] = await Promise.all([
      Database.use((db) =>
        db
          .select()
          .from(TpRolePermissionTable)
          .where(inArray(TpRolePermissionTable.role_id, role_ids))
          .all(),
      ),
      Database.use((db) => db.select().from(TpPermissionTable).all()),
      Database.use((db) =>
        db
          .select({
            role_id: TpUserRoleTable.role_id,
            total: sql<number>`count(*)`,
          })
          .from(TpUserRoleTable)
          .where(inArray(TpUserRoleTable.role_id, role_ids))
          .groupBy(TpUserRoleTable.role_id)
          .all(),
      ),
    ])
    const permByID = new Map(perms.map((item) => [item.id, item.code]))
    const codeByRole = links.reduce(
      (acc, item) => {
        const code = permByID.get(item.permission_id)
        if (!code) return acc
        const list = acc.get(item.role_id)
        if (list) list.push(code)
        if (!list) acc.set(item.role_id, [code])
        return acc
      },
      new Map<string, string[]>(),
    )
    const memberByRole = new Map(users.map((item) => [item.role_id, Number(item.total)]))
    return rows.map((item) => ({
      ...item,
      name: item.name || roleName(item.code),
      permissions: [...new Set(codeByRole.get(item.id) ?? [])].sort(),
      member_count: memberByRole.get(item.id) ?? 0,
    }))
  }

  export async function listRoles() {
    const rows = await Database.use((db) => db.select().from(TpRoleTable).orderBy(TpRoleTable.code).all())
    return await roleItems(rows)
  }

  export async function listRolesPaged(input?: { page?: number; page_size?: number }) {
    const page = input?.page ?? 1
    const page_size = input?.page_size ?? 15
    const offset = (page - 1) * page_size
    const [rows, totalRow] = await Promise.all([
      Database.use((db) =>
        db
          .select()
          .from(TpRoleTable)
          .orderBy(TpRoleTable.code)
          .limit(page_size)
          .offset(offset)
          .all(),
      ),
      Database.use((db) =>
        db
          .select({
            total: sql<number>`count(*)`,
          })
          .from(TpRoleTable)
          .get(),
      ),
    ])
    const items = await roleItems(rows)
    return {
      items,
      total: Number(totalRow?.total ?? 0),
      page,
      page_size,
    }
  }

  function userFilter(input?: { org_id?: string; department_id?: string; keyword?: string }) {
    const conditions: SQL[] = []
    if (input?.org_id) conditions.push(eq(TpUserTable.org_id, input.org_id))
    if (input?.department_id) conditions.push(eq(TpUserTable.department_id, input.department_id))
    if (input?.keyword) {
      const word = `%${input.keyword}%`
      const match = or(like(TpUserTable.username, word), like(TpUserTable.display_name, word), like(TpUserTable.phone, word))
      if (match) conditions.push(match)
    }
    return conditions
  }

  async function userItems(rows: UserRow[]) {
    if (rows.length === 0) return []
    const user_ids = rows.map((item) => item.id)
    const userRoles = await Database.use((db) =>
      db
        .select()
        .from(TpUserRoleTable)
        .where(inArray(TpUserRoleTable.user_id, user_ids))
        .all(),
    )

    const role_ids = [...new Set(userRoles.map((item) => item.role_id))]
    const roles =
      role_ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select()
              .from(TpRoleTable)
              .where(inArray(TpRoleTable.id, role_ids))
              .all(),
          )
    const roleCode = new Map(roles.map((item) => [item.id, item.code]))

    const rolePermLinks =
      role_ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select()
              .from(TpRolePermissionTable)
              .where(inArray(TpRolePermissionTable.role_id, role_ids))
              .all(),
          )
    const perm_ids = [...new Set(rolePermLinks.map((item) => item.permission_id))]
    const perms =
      perm_ids.length === 0
        ? []
        : await Database.use((db) =>
            db
              .select()
              .from(TpPermissionTable)
              .where(inArray(TpPermissionTable.id, perm_ids))
              .all(),
          )
    const permCode = new Map(perms.map((item) => [item.id, item.code]))

    const rolePerm = rolePermLinks.reduce(
      (acc, item) => {
        const code = permCode.get(item.permission_id)
        if (!code) return acc
        const list = acc.get(item.role_id)
        if (list) list.push(code)
        if (!list) acc.set(item.role_id, [code])
        return acc
      },
      new Map<string, string[]>(),
    )

    const userRole = userRoles.reduce(
      (acc, item) => {
        const list = acc.get(item.user_id)
        if (list) list.push(item.role_id)
        if (!list) acc.set(item.user_id, [item.role_id])
        return acc
      },
      new Map<string, string[]>(),
    )

    return rows.map((item) => {
      const ids = userRole.get(item.id) ?? []
      const role_codes = [...new Set(ids.map((id) => roleCode.get(id)).filter((x): x is string => !!x))]
      const permission_codes = [
        ...new Set(
          ids.flatMap((id) => rolePerm.get(id) ?? []),
        ),
      ]
      return {
        id: item.id,
        username: item.username,
        display_name: item.display_name,
        email: item.email,
        phone: item.phone,
        vho_user_id: item.vho_user_id ?? undefined,
        status: item.status,
        account_type: item.account_type,
        org_id: item.org_id,
        department_id: item.department_id ?? undefined,
        force_password_reset: item.force_password_reset,
        last_login_at: item.last_login_at ?? undefined,
        last_login_ip: item.last_login_ip ?? undefined,
        roles: role_codes,
        permissions: permission_codes,
      }
    })
  }

  export async function listUsers(input?: { org_id?: string; department_id?: string; keyword?: string }) {
    const conditions = userFilter(input)
    const where = conditions.length === 0 ? undefined : and(...conditions)
    const rows = await Database.use((db) => {
      if (where) {
        return db
          .select()
          .from(TpUserTable)
          .where(where)
          .orderBy(desc(TpUserTable.time_created), desc(TpUserTable.id))
          .all()
      }
      return db
        .select()
        .from(TpUserTable)
        .orderBy(desc(TpUserTable.time_created), desc(TpUserTable.id))
        .all()
    })
    return await userItems(rows)
  }

  export async function listUsersPaged(input?: {
    org_id?: string
    department_id?: string
    keyword?: string
    page?: number
    page_size?: number
  }) {
    const page = input?.page ?? 1
    const page_size = input?.page_size ?? 15
    const offset = (page - 1) * page_size
    const conditions = userFilter(input)
    const where = conditions.length === 0 ? undefined : and(...conditions)
    const [rows, totalRow] = await Promise.all([
      Database.use((db) => {
        if (where) {
          return db
            .select()
            .from(TpUserTable)
            .where(where)
            .orderBy(desc(TpUserTable.time_created), desc(TpUserTable.id))
            .limit(page_size)
            .offset(offset)
            .all()
        }
        return db
          .select()
          .from(TpUserTable)
          .orderBy(desc(TpUserTable.time_created), desc(TpUserTable.id))
          .limit(page_size)
          .offset(offset)
          .all()
      }),
      Database.use((db) => {
        if (where) {
          return db
            .select({
              total: sql<number>`count(*)`,
            })
            .from(TpUserTable)
            .where(where)
            .get()
        }
        return db
          .select({
            total: sql<number>`count(*)`,
          })
          .from(TpUserTable)
          .get()
      }),
    ])
    const items = await userItems(rows)
    return {
      items,
      total: Number(totalRow?.total ?? 0),
      page,
      page_size,
    }
  }

  export async function createOrganization(input: {
    name: string
    code: string
    org_type: "internal" | "hospital" | "partner"
    parent_id?: string
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const exists = await orgByCode(input.code)
    if (exists) return { ok: false as const, code: "org_exists" }
    const org_id = ulid()
    await Database.use(async (db) => {
      await db.insert(TpOrganizationTable)
        .values({
          id: org_id,
          name: input.name,
          code: input.code,
          org_type: input.org_type,
          parent_id: input.parent_id,
        })
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.org.create",
      target_type: "tp_organization",
      target_id: org_id,
      result: "success",
      detail_json: {
        code: input.code,
        org_type: input.org_type,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const, id: org_id }
  }

  export async function createDepartment(input: {
    org_id: string
    name: string
    code?: string
    parent_id?: string
    sort_order?: number
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const org = await Database.use((db) => db.select().from(TpOrganizationTable).where(eq(TpOrganizationTable.id, input.org_id)).get())
    if (!org) return { ok: false as const, code: "org_missing" }
    const department_id = ulid()
    await Database.use(async (db) => {
      await db.insert(TpDepartmentTable)
        .values({
          id: department_id,
          org_id: input.org_id,
          parent_id: input.parent_id,
          name: input.name,
          code: input.code,
          sort_order: input.sort_order ?? 0,
        })
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.department.create",
      target_type: "tp_department",
      target_id: department_id,
      result: "success",
      detail_json: {
        org_id: input.org_id,
        code: input.code,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const, id: department_id }
  }

  export async function createRole(input: {
    code: string
    name: string
    scope?: "system" | "org"
    description?: string
    permission_codes?: string[]
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const code = input.code.trim().toLowerCase()
    if (!roleCodeValid(code)) return { ok: false as const, code: "role_code_invalid" }
    const name = input.name.trim()
    if (!name) return { ok: false as const, code: "role_name_invalid" }
    const exists = await Database.use((db) => db.select({ id: TpRoleTable.id }).from(TpRoleTable).where(eq(TpRoleTable.code, code)).get())
    if (exists) return { ok: false as const, code: "role_exists" }
    const permission_codes = [
      ...new Set(
        input.permission_codes && input.permission_codes.length > 0 ? input.permission_codes : [...rolePerm.developer],
      ),
    ]
    const permission_ids = await permissionIDs(permission_codes)
    if (permission_ids.length !== permission_codes.length) return { ok: false as const, code: "permission_missing" }
    const role_id = ulid()
    await Database.use(async (db) => {
      await db.insert(TpRoleTable)
        .values({
          id: role_id,
          code,
          name,
          scope: input.scope ?? "system",
          description: input.description?.trim() || undefined,
          status: "active",
        })
        .run()
      if (permission_ids.length === 0) return
      await db.insert(TpRolePermissionTable)
        .values(permission_ids.map((permission_id) => ({ role_id, permission_id })))
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.role.create",
      target_type: "tp_role",
      target_id: role_id,
      result: "success",
      detail_json: {
        code,
        name,
        scope: input.scope ?? "system",
        permission_codes,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return {
      ok: true as const,
      id: role_id,
      code,
      name,
      scope: input.scope ?? "system",
    }
  }

  export async function createUser(input: {
    username: string
    password: string
    display_name?: string
    email?: string
    phone?: string
    account_type: "internal" | "hospital" | "partner"
    org_id: string
    department_id?: string
    role_codes?: string[]
    force_password_reset?: boolean
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    if (!UserPassword.valid(input.password)) return { ok: false as const, code: "password_invalid" }
    const phone = input.phone === undefined ? undefined : UserPhone.normalize(input.phone)
    if (input.phone !== undefined && !phone) return { ok: false as const, code: "phone_invalid" }
    const exists = await userByUsername(input.username)
    if (exists) return { ok: false as const, code: "username_exists" }
    const org = await Database.use((db) => db.select().from(TpOrganizationTable).where(eq(TpOrganizationTable.id, input.org_id)).get())
    if (!org) return { ok: false as const, code: "org_missing" }
    if (input.department_id) {
      const department_id = input.department_id
      const department = await Database.use((db) =>
        db
          .select()
          .from(TpDepartmentTable)
          .where(and(eq(TpDepartmentTable.id, department_id), eq(TpDepartmentTable.org_id, input.org_id)))
          .get(),
      )
      if (!department) return { ok: false as const, code: "department_missing" }
    }

    const user_id = ulid()
    const password_hash = await UserPassword.hash(input.password)
    const codes = [...new Set(input.role_codes && input.role_codes.length > 0 ? input.role_codes : [defaultRole(input.account_type)])]
    const role_ids = await roleIDs(codes)
    if (role_ids.length !== codes.length) return { ok: false as const, code: "role_missing" }
    await Database.use(async (db) => {
      await db.insert(TpUserTable)
        .values({
          id: user_id,
          username: input.username,
          password_hash,
          display_name: input.display_name ?? input.username,
          email: input.email,
          phone,
          account_type: input.account_type,
          org_id: input.org_id,
          department_id: input.department_id,
          force_password_reset: input.force_password_reset ?? true,
          external_source: "tpcode",
        })
        .run()
      if (role_ids.length > 0) {
        await db.insert(TpUserRoleTable)
          .values(role_ids.map((role_id) => ({ user_id, role_id })))
          .run()
      }
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.user.create",
      target_type: "tp_user",
      target_id: user_id,
      result: "success",
      detail_json: {
        username: input.username,
        account_type: input.account_type,
        org_id: input.org_id,
        role_codes: codes,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const, id: user_id }
  }

  export async function setUserRoles(input: {
    user_id: string
    role_codes: string[]
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const codes = [...new Set(input.role_codes)]
    const role_ids = await roleIDs(codes)
    if (role_ids.length !== codes.length) return { ok: false as const, code: "role_missing" }
    await Database.use(async (db) => {
      await db.delete(TpUserRoleTable).where(eq(TpUserRoleTable.user_id, input.user_id)).run()
      if (role_ids.length > 0) {
        await db.insert(TpUserRoleTable)
          .values(role_ids.map((role_id) => ({ user_id: input.user_id, role_id })))
          .run()
      }
    })
    invalidateByUserID(input.user_id)
    AccountContextService.invalidateProjectAccess({ user_id: input.user_id })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.user.roles.update",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      detail_json: { role_codes: codes },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function updateOrganization(input: {
    org_id: string
    name?: string
    status?: "active" | "inactive"
    parent_id?: string
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const org = await Database.use((db) => db.select().from(TpOrganizationTable).where(eq(TpOrganizationTable.id, input.org_id)).get())
    if (!org) return { ok: false as const, code: "org_missing" }
    await Database.use(async (db) => {
      await db.update(TpOrganizationTable)
        .set({
          name: input.name,
          status: input.status,
          parent_id: input.parent_id,
          time_updated: Date.now(),
        })
        .where(eq(TpOrganizationTable.id, input.org_id))
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.org.update",
      target_type: "tp_organization",
      target_id: input.org_id,
      result: "success",
      detail_json: {
        name: input.name,
        status: input.status,
        parent_id: input.parent_id,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function updateDepartment(input: {
    department_id: string
    name?: string
    code?: string
    status?: "active" | "inactive"
    sort_order?: number
    parent_id?: string
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const department = await Database.use((db) =>
      db.select().from(TpDepartmentTable).where(eq(TpDepartmentTable.id, input.department_id)).get(),
    )
    if (!department) return { ok: false as const, code: "department_missing" }
    if (input.parent_id) {
      const parent_id = input.parent_id
      if (input.parent_id === input.department_id) return { ok: false as const, code: "department_parent_invalid" }
      const parent = await Database.use((db) =>
        db
          .select()
          .from(TpDepartmentTable)
          .where(and(eq(TpDepartmentTable.id, parent_id), eq(TpDepartmentTable.org_id, department.org_id)))
          .get(),
      )
      if (!parent) return { ok: false as const, code: "department_parent_missing" }
    }
    await Database.use(async (db) => {
      await db.update(TpDepartmentTable)
        .set({
          name: input.name,
          code: input.code,
          status: input.status,
          sort_order: input.sort_order,
          parent_id: input.parent_id,
          time_updated: Date.now(),
        })
        .where(eq(TpDepartmentTable.id, input.department_id))
        .run()
    })
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.department.update",
      target_type: "tp_department",
      target_id: input.department_id,
      result: "success",
      detail_json: {
        name: input.name,
        code: input.code,
        status: input.status,
        sort_order: input.sort_order,
        parent_id: input.parent_id,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function updateUser(input: {
    user_id: string
    display_name?: string
    email?: string
    phone?: string
    status?: "active" | "inactive"
    department_id?: string | null
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const user = await userByID(input.user_id)
    if (!user) return { ok: false as const, code: "user_missing" }
    const phone = input.phone === undefined ? undefined : UserPhone.normalize(input.phone)
    if (input.phone !== undefined && !!input.phone.trim() && !phone) return { ok: false as const, code: "phone_invalid" }
    const next_phone = input.phone === undefined ? undefined : phone || null
    if (input.department_id) {
      const department_id = input.department_id
      const department = await Database.use((db) =>
        db
          .select()
          .from(TpDepartmentTable)
          .where(and(eq(TpDepartmentTable.id, department_id), eq(TpDepartmentTable.org_id, user.org_id)))
          .get(),
      )
      if (!department) return { ok: false as const, code: "department_missing" }
    }
    await Database.use(async (db) => {
      await db.update(TpUserTable)
        .set({
          display_name: input.display_name,
          email: input.email,
          phone: next_phone,
          status: input.status,
          department_id: input.department_id === null ? null : input.department_id,
          time_updated: Date.now(),
        })
        .where(eq(TpUserTable.id, input.user_id))
        .run()
    })
    invalidateByUserID(input.user_id)
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.user.update",
      target_type: "tp_user",
      target_id: input.user_id,
      result: "success",
      detail_json: {
        display_name: input.display_name,
        email: input.email,
        phone: next_phone ?? undefined,
        status: input.status,
        department_id: input.department_id,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }

  export async function setRolePermissions(input: {
    role_code: string
    permission_codes: string[]
    actor_user_id?: string
    ip?: string
    user_agent?: string
  }) {
    const role = await Database.use((db) => db.select().from(TpRoleTable).where(eq(TpRoleTable.code, input.role_code)).get())
    if (!role) return { ok: false as const, code: "role_missing" }
    const codes = [...new Set(input.permission_codes)]
    const permission_ids = await permissionIDs(codes)
    if (permission_ids.length !== codes.length) return { ok: false as const, code: "permission_missing" }
    const affectedUsers = await Database.use((db) =>
      db
        .select({ user_id: TpUserRoleTable.user_id })
        .from(TpUserRoleTable)
        .where(eq(TpUserRoleTable.role_id, role.id))
        .all(),
    )
    await Database.use(async (db) => {
      await db.delete(TpRolePermissionTable).where(eq(TpRolePermissionTable.role_id, role.id)).run()
      if (permission_ids.length > 0) {
        await db.insert(TpRolePermissionTable)
          .values(permission_ids.map((permission_id) => ({ role_id: role.id, permission_id })))
          .run()
      }
    })
    for (const item of affectedUsers) {
      invalidateByUserID(item.user_id)
    }
    auditLater({
      actor_user_id: input.actor_user_id,
      action: "account.role.permissions.update",
      target_type: "tp_role",
      target_id: role.id,
      result: "success",
      detail_json: {
        role_code: input.role_code,
        permission_codes: codes,
      },
      ip: input.ip,
      user_agent: input.user_agent,
    })
    return { ok: true as const }
  }
}
