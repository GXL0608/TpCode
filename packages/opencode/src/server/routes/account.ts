import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { UserService } from "@/user/service"
import { UserRbac } from "@/user/rbac"
import { AccountContextService } from "@/user/context"
import { AccountProjectCatalogService } from "@/user/project-catalog"
import { AccountSystemSettingService } from "@/user/system-setting"
import { errors } from "../error"
import { Flag } from "@/flag/flag"
import { Auth } from "@/auth"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { readdir } from "fs/promises"

const LoginResult = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    access_expires_at: z.number(),
    refresh_expires_at: z.number(),
    user: z.object({
      id: z.string(),
      username: z.string(),
      display_name: z.string(),
      account_type: z.string(),
      org_id: z.string(),
      department_id: z.string().optional(),
      force_password_reset: z.boolean(),
      context_project_id: z.string().optional(),
      roles: z.array(z.string()),
      permissions: z.array(z.string()),
    }),
  })
  .meta({ ref: "AccountLoginResult" })

function requireLogin(c: Context) {
  const user_id = c.get("account_user_id") as string | undefined
  if (!user_id) return c.json({ error: "unauthorized" }, 401)
  return user_id
}

function requireProviderConfig(c: Context) {
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!permissions) return
  if (permissions.includes("provider:config_global")) return
  return c.json(
    {
      error: "forbidden",
      permission: "provider:config_global",
    },
    403,
  )
}

function requireUserProviderConfig(c: Context) {
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!permissions) return
  if (!permissions.includes("provider:config_user")) {
    return c.json(
      {
        error: "forbidden",
        permission: "provider:config_user",
      },
      403,
    )
  }
}

function requireUserList(c: Context) {
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!permissions) return
  if (permissions.includes("user:manage") || permissions.includes("role:manage")) return
  return c.json(
    {
      error: "forbidden",
      permission: "user:manage|role:manage",
    },
    403,
  )
}

async function roots() {
  if (process.platform !== "win32") return ["/"] as string[]
  const drives = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
  const rows = await Promise.all(
    drives.map(async (letter) => {
      const drive = `${letter}:\\`
      if (!(await Filesystem.isDir(drive))) return
      return drive
    }),
  )
  return rows.filter((item): item is string => !!item)
}

function parent(input: string) {
  const current = path.resolve(input)
  const root = path.parse(current).root
  if (current === root) return
  const value = path.dirname(current)
  if (value === current) return
  return value
}

export const AccountRoutes = lazy(() =>
  new Hono()
    .use(async (c, next) => {
      if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json({ error: "account_disabled" }, 404)
      return next()
    })
    .post(
      "/register",
      describeRoute({
        summary: "Register account",
        description: "Register a new account for tpCode account system.",
        operationId: "account.register",
        responses: {
          200: {
            description: "Register result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string().min(3),
          password: z.string().min(8),
          display_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().min(1),
        }),
      ),
      async (c) => {
        await UserService.ensureSeedOnce()
        const body = c.req.valid("json")
        const result = await UserService.register({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/login",
      describeRoute({
        summary: "Login",
        description: "Login with username and password.",
        operationId: "account.login",
        responses: {
          200: {
            description: "Login result",
            content: {
              "application/json": {
                schema: resolver(LoginResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string(),
          password: z.string(),
        }),
      ),
      async (c) => {
        await UserService.ensureSeedOnce()
        const body = c.req.valid("json")
        const result = await UserService.login({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/token/refresh",
      describeRoute({
        summary: "Refresh access token",
        description: "Refresh access token by refresh token.",
        operationId: "account.token.refresh",
        responses: {
          200: {
            description: "Token result",
            content: {
              "application/json": {
                schema: resolver(LoginResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          refresh_token: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const result = await UserService.refresh({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout current session",
        description: "Revoke current access token.",
        operationId: "account.logout",
        responses: {
          200: {
            description: "Result",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const token = UserService.parseBearer(c.req.header("authorization"))
        if (!token) return c.json({ error: "unauthorized" }, 401)
        await UserService.revokeToken({ token })
        UserService.auditLater({
          actor_user_id: user_id,
          action: "account.logout",
          target_type: "tp_user",
          target_id: user_id,
          result: "success",
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .post(
      "/logout-all",
      describeRoute({
        summary: "Logout all sessions",
        description: "Revoke all tokens for current user.",
        operationId: "account.logout.all",
        responses: {
          200: {
            description: "Result",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        await UserService.revokeAll({ user_id })
        UserService.auditLater({
          actor_user_id: user_id,
          action: "account.logout_all",
          target_type: "tp_user",
          target_id: user_id,
          result: "success",
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .get(
      "/me",
      describeRoute({
        summary: "Current user",
        description: "Get current authenticated account profile.",
        operationId: "account.me",
        responses: {
          200: {
            description: "Current user",
            content: {
              "application/json": {
                schema: resolver(LoginResult.shape.user),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        const cached = c.get("account_user" as never) as z.infer<typeof LoginResult.shape.user> | undefined
        const me = cached ?? (await UserService.me({ user_id, context_project_id }))
        if (!me) return c.json({ error: "unauthorized" }, 401)
        return c.json(me)
      },
    )
    .get(
      "/me/vho-bind",
      validator("query", z.object({}).optional()),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const info = await UserService.meVho(user_id)
        if (!info) return c.json({ error: "unauthorized" }, 401)
        return c.json(info)
      },
    )
    .post(
      "/me/vho-bind",
      validator(
        "json",
        z.object({
          phone: z.string().min(1),
        }),
      ),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const body = c.req.valid("json")
        const result = await UserService.bindMyPhone({
          user_id,
          phone: body.phone,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        const info = await UserService.meVho(user_id)
        return c.json({
          ...result,
          phone: info?.phone,
          phone_bound: info?.phone_bound,
          vho_bound: info?.vho_bound,
          bound: info?.bound,
        })
      },
    )
    .get(
      "/context/projects",
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        return c.json(await AccountContextService.listProjects({ user_id, context_project_id }))
      },
    )
    .get(
      "/context/current",
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        return c.json({
          context_project_id,
          last_project_id: await AccountContextService.lastProject(user_id),
        })
      },
    )
    .post(
      "/context/select",
      validator("json", z.object({ project_id: z.string().min(1) })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const body = c.req.valid("json")
        const result = await UserService.selectContext({
          user_id,
          project_id: body.project_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .get(
      "/me/provider/:provider_id",
      describeRoute({
        summary: "Current user provider credential",
        description: "Get current authenticated user's own provider credential.",
        operationId: "account.me.provider",
        responses: {
          200: {
            description: "Provider credential",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    provider_id: z.string(),
                    configured: z.boolean(),
                    source: z.enum(["none", "user", "global"]),
                    auth_type: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const param = c.req.valid("param")
        const own = await Auth.userAllByID(user_id)
        if (own[param.provider_id]) {
          return c.json({
            provider_id: param.provider_id,
            configured: true,
            source: "user" as const,
            auth_type: own[param.provider_id].type,
          })
        }
        const visible = await Auth.all()
        if (visible[param.provider_id]) {
          return c.json({
            provider_id: param.provider_id,
            configured: true,
            source: "global" as const,
            auth_type: visible[param.provider_id].type,
          })
        }
        return c.json({
          provider_id: param.provider_id,
          configured: false,
          source: "none" as const,
        })
      },
    )
    .get(
      "/admin/roles",
      UserRbac.require("role:manage"),
      validator(
        "query",
        z.object({
          page: z.coerce.number().int().min(1).optional(),
          page_size: z.coerce.number().int().min(1).max(100).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        if (!query.page && !query.page_size) return c.json(await UserService.listRoles())
        return c.json(
          await UserService.listRolesPaged({
            page: query.page ?? 1,
            page_size: query.page_size ?? 15,
          }),
        )
      },
    )
    .get(
      "/admin/settings/project-scan-root",
      UserRbac.require("role:manage"),
      async (c) => c.json(await AccountSystemSettingService.projectScanRoot()),
    )
    .get(
      "/admin/fs/directories",
      UserRbac.require("role:manage"),
      validator(
        "query",
        z.object({
          path: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const current = query.path?.trim()
        if (!current) {
          const directories = (await roots()).map((item) => ({ path: item, name: item }))
          return c.json({
            ok: true as const,
            current: "",
            directories,
          })
        }
        if (!(await Filesystem.isDir(current))) {
          return c.json({ ok: false as const, code: "directory_missing" }, 400)
        }
        const full = path.resolve(current)
        const entries = await readdir(full, { withFileTypes: true }).catch(() => [] as Awaited<ReturnType<typeof readdir>>)
        const directories = entries
          .filter((item) => item.isDirectory())
          .map((item) => ({
            path: path.join(full, item.name),
            name: item.name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        return c.json({
          ok: true as const,
          current: full,
          parent: parent(full),
          directories,
        })
      },
    )
    .put(
      "/admin/settings/project-scan-root",
      UserRbac.require("role:manage"),
      validator(
        "json",
        z.object({
          project_scan_root: z.string().optional(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await AccountSystemSettingService.setProjectScanRoot({
          project_scan_root: body.project_scan_root,
        })
        await UserService.audit({
          actor_user_id,
          action: "account.system.project_scan_root.set",
          target_type: "system",
          target_id: "project_scan_root",
          result: "success",
          detail_json: {
            project_scan_root: result.project_scan_root ?? "",
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .get(
      "/admin/permissions",
      UserRbac.require("role:manage"),
      async (c) => {
        await UserService.ensureSeed()
        return c.json(await UserService.listPermissions())
      },
    )
    .get(
      "/admin/projects/catalog",
      UserRbac.require("role:manage"),
      validator(
        "query",
        z.object({
          source: z.enum(["all", "registered", "scanned"]).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await AccountProjectCatalogService.list({ source: query.source }))
      },
    )
    .get(
      "/admin/roles/:role_code/projects",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      async (c) => {
        const param = c.req.valid("param")
        const result = await AccountContextService.roleProjects(param.role_code)
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .put(
      "/admin/roles/:role_code/projects",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      validator("json", z.object({ project_ids: z.array(z.string()) })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await AccountContextService.setRoleProjects({
          role_code: param.role_code,
          project_ids: body.project_ids,
        })
        if (!result.ok) return c.json(result, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.role.projects.update",
          target_type: "tp_role",
          target_id: param.role_code,
          result: "success",
          detail_json: {
            project_ids: body.project_ids,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .post(
      "/admin/roles/:role_code/permissions",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      validator("json", z.object({ permission_codes: z.array(z.string()) })),
      async (c) => {
        await UserService.ensureSeed()
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await UserService.setRolePermissions({
          role_code: param.role_code,
          permission_codes: body.permission_codes,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .get("/admin/provider/global", UserRbac.require("provider:config_global"), async (c) => c.json(await Auth.sharedAll()))
    .put(
      "/admin/provider/:provider_id/global",
      UserRbac.require("provider:config_global"),
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", Auth.Info),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await Auth.setGlobal(param.provider_id, body)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.set",
          target_type: "provider",
          target_id: param.provider_id,
          result: "success",
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .delete(
      "/admin/provider/:provider_id/global",
      UserRbac.require("provider:config_global"),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        await Auth.removeGlobal(param.provider_id)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.remove",
          target_type: "provider",
          target_id: param.provider_id,
          result: "success",
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .get(
      "/admin/project-access/role",
      UserRbac.require("role:manage"),
      validator("query", z.object({ project_id: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await AccountContextService.listRoleAccess({ project_id: query.project_id }))
      },
    )
    .post(
      "/admin/project-access/role",
      UserRbac.require("role:manage"),
      validator(
        "json",
        z.object({
          project_id: z.string(),
          role_codes: z.array(z.string()),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await AccountContextService.setRoleAccess({
          project_id: body.project_id,
          role_codes: body.role_codes,
        })
        if (!result.ok) return c.json(result, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.project_access.role.set",
          target_type: "project",
          target_id: body.project_id,
          result: "success",
          detail_json: {
            role_codes: body.role_codes,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .get(
      "/admin/project-access/user",
      UserRbac.require("user:manage"),
      validator(
        "query",
        z.object({
          project_id: z.string().optional(),
          user_id: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          await AccountContextService.listUserAccess({
            project_id: query.project_id,
            user_id: query.user_id,
          }),
        )
      },
    )
    .post(
      "/admin/project-access/user",
      UserRbac.require("user:manage"),
      validator(
        "json",
        z.object({
          project_id: z.string(),
          user_id: z.string(),
          mode: z.enum(["allow", "deny", "remove"]),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await AccountContextService.setUserAccess({
          project_id: body.project_id,
          user_id: body.user_id,
          mode: body.mode,
        })
        if (!result.ok) return c.json(result, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.project_access.user.set",
          target_type: "project",
          target_id: body.project_id,
          result: "success",
          detail_json: {
            user_id: body.user_id,
            mode: body.mode,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .get(
      "/admin/vho-bind",
      UserRbac.require("user:manage"),
      validator(
        "query",
        z.object({
          keyword: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const users = await UserService.listUsers({
          keyword: query.keyword,
        })
        return c.json(
          users.map((item) => ({
            user_id: item.id,
            username: item.username,
            display_name: item.display_name,
            phone: item.phone,
            vho_user_id: item.vho_user_id,
            bound: !!item.vho_user_id,
          })),
        )
      },
    )
    .post(
      "/admin/vho-bind",
      UserRbac.require("user:manage"),
      validator(
        "json",
        z.object({
          user_id: z.string(),
          vho_user_id: z.string().optional(),
          phone: z.string().optional(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await UserService.bindVho({
          user_id: body.user_id,
          vho_user_id: body.vho_user_id,
          phone: body.phone,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .get(
      "/admin/audit",
      UserRbac.require("audit:view"),
      validator(
        "query",
        z.object({
          actor_user_id: z.string().optional(),
          action: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          await UserService.listAudit({
            actor_user_id: query.actor_user_id,
            action: query.action,
            limit: query.limit,
          }),
        )
      },
    )
    .get(
      "/admin/users",
      async (c, next) => {
        const denied = requireUserList(c)
        if (denied) return denied
        return next()
      },
      validator(
        "query",
        z.object({
          org_id: z.string().optional(),
          department_id: z.string().optional(),
          keyword: z.string().optional(),
          page: z.coerce.number().int().min(1).optional(),
          page_size: z.coerce.number().int().min(1).max(100).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        if (query.page || query.page_size) {
          return c.json(
            await UserService.listUsersPaged({
              org_id: query.org_id,
              department_id: query.department_id,
              keyword: query.keyword,
              page: query.page ?? 1,
              page_size: query.page_size ?? 15,
            }),
          )
        }
        return c.json(
          await UserService.listUsers({
            org_id: query.org_id,
            department_id: query.department_id,
            keyword: query.keyword,
          }),
        )
      },
    )
    .post(
      "/admin/users",
      UserRbac.require("user:manage"),
      validator(
        "json",
        z.object({
          username: z.string().min(3),
          password: z.string().min(8),
          display_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().min(1),
          account_type: z.enum(["internal", "hospital", "partner"]),
          org_id: z.string(),
          department_id: z.string().optional(),
          role_codes: z.array(z.string()).optional(),
          force_password_reset: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await UserService.createUser({
          ...body,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .patch(
      "/admin/users/:user_id",
      UserRbac.require("user:manage"),
      validator("param", z.object({ user_id: z.string() })),
      validator(
        "json",
        z.object({
          display_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          status: z.enum(["active", "inactive"]).optional(),
          department_id: z.string().nullable().optional(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await UserService.updateUser({
          user_id: param.user_id,
          ...body,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/admin/users/:user_id/password/reset",
      UserRbac.require("user:manage"),
      validator("param", z.object({ user_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const result = await UserService.resetUserPassword({
          user_id: param.user_id,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .get(
      "/admin/users/:user_id/providers",
      validator("param", z.object({ user_id: z.string() })),
      async (c) => {
        const denied = requireUserProviderConfig(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const user = await UserService.userByID(param.user_id)
        if (!user) return c.json({ ok: false, code: "user_missing" }, 400)
        const rows = await Auth.userAllByID(param.user_id)
        return c.json(
          Object.entries(rows).map(([provider_id, info]) => ({
            provider_id,
            configured: true,
            auth_type: info.type,
          })),
        )
      },
    )
    .put(
      "/admin/users/:user_id/providers/:provider_id",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      validator("json", Auth.Info),
      async (c) => {
        const denied = requireUserProviderConfig(c)
        if (denied) return denied
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const user = await UserService.userByID(param.user_id)
        if (!user) return c.json({ ok: false, code: "user_missing" }, 400)
        await Auth.setUser(param.user_id, param.provider_id, body)
        await UserService.audit({
          actor_user_id,
          action: "account.user.provider.set",
          target_type: "tp_user",
          target_id: param.user_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
            auth_type: body.type,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .delete(
      "/admin/users/:user_id/providers/:provider_id",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      async (c) => {
        const denied = requireUserProviderConfig(c)
        if (denied) return denied
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        await Auth.removeUser(param.user_id, param.provider_id)
        await UserService.audit({
          actor_user_id,
          action: "account.user.provider.remove",
          target_type: "tp_user",
          target_id: param.user_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(true)
      },
    )
    .post(
      "/admin/users/:user_id/roles",
      UserRbac.require("role:manage"),
      validator("param", z.object({ user_id: z.string() })),
      validator("json", z.object({ role_codes: z.array(z.string()) })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await UserService.setUserRoles({
          user_id: param.user_id,
          role_codes: body.role_codes,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/password/change",
      describeRoute({
        summary: "Change password",
        description: "Change password for current authenticated user.",
        operationId: "account.password.change",
        responses: {
          200: {
            description: "Result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          current_password: z.string(),
          new_password: z.string(),
        }),
      ),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const body = c.req.valid("json")
        const result = await UserService.changePassword({
          ...body,
          user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/password/forgot/request",
      describeRoute({
        summary: "Request password reset",
        description: "Create password reset code for the user.",
        operationId: "account.password.forgot.request",
        responses: {
          200: {
            description: "Result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), reset_code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ username: z.string() })),
      async (c) => {
        const body = c.req.valid("json")
        const result = await UserService.resetRequest({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .post(
      "/password/forgot/reset",
      describeRoute({
        summary: "Reset password",
        description: "Reset password by reset code.",
        operationId: "account.password.forgot.reset",
        responses: {
          200: {
            description: "Result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string(),
          code: z.string(),
          new_password: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const result = await UserService.resetPassword({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    ),
)
