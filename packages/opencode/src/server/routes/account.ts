import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { UserService } from "@/user/service"
import { UserRbac } from "@/user/rbac"
import { errors } from "../error"
import { Flag } from "@/flag/flag"
import { Auth } from "@/auth"

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
  if (permissions.includes("provider:config_own") || permissions.includes("provider:config_global")) return
  return c.json(
    {
      error: "forbidden",
      permission: "provider:config_own",
    },
    403,
  )
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
          phone: z.string().optional(),
          invite_code: z.string().optional(),
        }),
      ),
      async (c) => {
        await UserService.ensureSeed()
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
        await UserService.ensureSeed()
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
        const me = await UserService.me(user_id)
        if (!me) return c.json({ error: "unauthorized" }, 401)
        return c.json(me)
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
                    auth: Auth.Info.nullable(),
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
        const permissions = c.get("account_permissions" as never) as string[] | undefined
        if (
          permissions &&
          !permissions.includes("provider:config_own") &&
          !permissions.includes("provider:config_global")
        ) {
          return c.json(
            {
              error: "forbidden",
              permission: "provider:config_own",
            },
            403,
          )
        }
        const param = c.req.valid("param")
        const all = await Auth.userAll()
        return c.json({
          provider_id: param.provider_id,
          auth: all[param.provider_id] ?? null,
        })
      },
    )
    .get("/admin/roles", UserRbac.require("role:manage"), async (c) => c.json(await UserService.listRoles()))
    .get("/admin/permissions", UserRbac.require("role:manage"), async (c) => c.json(await UserService.listPermissions()))
    .post(
      "/admin/roles/:role_code/permissions",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      validator("json", z.object({ permission_codes: z.array(z.string()) })),
      async (c) => {
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
      UserRbac.require("user:manage"),
      validator(
        "query",
        z.object({
          org_id: z.string().optional(),
          department_id: z.string().optional(),
          keyword: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
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
          phone: z.string().optional(),
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
