import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { UserService } from "@/user/service"
import { UserRbac } from "@/user/rbac"
import { AccountContextService } from "@/user/context"
import { UserRbac } from "@/user/rbac"
import { AccountProjectCatalogService } from "@/user/project-catalog"
import { AccountProjectStateService } from "@/user/project-state"
import { AccountSystemSettingService } from "@/user/system-setting"
import { AccountProductService } from "@/user/product"
import { errors } from "../error"
import { Flag } from "@/flag/flag"
import { Auth } from "@/auth"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { readdir } from "fs/promises"
import { PlanService } from "@/plan/service"
import { PlanEvalService } from "@/plan/eval-service"
import { Config } from "@/config/config"
import { AccountProviderState } from "@/provider/account-provider-state"
import { AccountUserProviderSettingService } from "@/user/user-provider-setting"

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
      feedback_enabled: z.boolean(),
    }),
  })
  .meta({ ref: "AccountLoginResult" })

const PlanSaveBody = z.object({
  session_id: z.string().min(1),
  message_id: z.string().min(1),
  part_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  vho_feedback_no: z.string().optional(),
})

const PlanSaveSuccess = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    saved_at: z.number(),
    session_id: z.string(),
    message_id: z.string(),
    part_id: z.string(),
  })
  .meta({ ref: "AccountPlanSaveSuccess" })

const PlanSaveFailure = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      "session_missing",
      "message_missing",
      "plan_message_required",
      "part_missing",
      "plan_text_missing",
      "forbidden",
      "oracle_feedback_missing",
      "oracle_feedback_update_failed",
      "oracle_feedback_row_count_invalid",
    ]),
    message: z.string().optional(),
    permission: z.string().optional(),
  })
  .meta({ ref: "AccountPlanSaveFailure" })

const PlanEvalRetrySuccess = z
  .object({
    ok: z.literal(true),
    plan_id: z.string(),
  })
  .meta({ ref: "AccountPlanEvalRetrySuccess" })

const PlanEvalRetryFailure = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      "plan_eval_missing",
      "plan_eval_retry_invalid",
      "plan_eval_plan_missing",
      "plan_eval_assistant_missing",
      "plan_eval_user_missing",
      "forbidden",
    ]),
    permission: z.string().optional(),
  })
  .meta({ ref: "AccountPlanEvalRetryFailure" })

const PlanEvalDetailSuccess = z
  .object({
    ok: z.literal(true),
    eval: z.object({
      id: z.string(),
      plan_id: z.string(),
      vho_feedback_no: z.string().nullable().optional(),
      user_id: z.string(),
      session_id: z.string(),
      user_message_id: z.string(),
      assistant_message_id: z.string(),
      part_id: z.string(),
      status: z.string(),
      rubric_version: z.string().nullable().optional(),
      prompt_version: z.string().nullable().optional(),
      judge_provider_id: z.string().nullable().optional(),
      judge_model_id: z.string().nullable().optional(),
      user_score: z.number().nullable().optional(),
      assistant_score: z.number().nullable().optional(),
      summary: z.string().nullable().optional(),
      major_issue_side: z.string().nullable().optional(),
      result_json: z.record(z.string(), z.unknown()).nullable().optional(),
      error_code: z.string().nullable().optional(),
      error_message: z.string().nullable().optional(),
      time_started: z.number().nullable().optional(),
      time_finished: z.number().nullable().optional(),
      time_created: z.number(),
      time_updated: z.number(),
    }),
    items: z.array(
      z.object({
        id: z.string(),
        eval_id: z.string(),
        plan_id: z.string(),
        vho_feedback_no: z.string().nullable().optional(),
        subject: z.string(),
        dimension_code: z.string(),
        dimension_name: z.string(),
        max_deduction: z.number(),
        deducted_score: z.number(),
        final_score: z.number(),
        reason: z.string(),
        evidence_json: z.array(z.string()),
        position: z.number(),
        time_created: z.number(),
        time_updated: z.number(),
      }),
    ),
  })
  .meta({ ref: "AccountPlanEvalDetailSuccess" })

const PlanEvalDetailFailure = z
  .object({
    ok: z.literal(false),
    code: z.enum(["plan_eval_missing", "forbidden"]),
    permission: z.string().optional(),
  })
  .meta({ ref: "AccountPlanEvalDetailFailure" })

const ModelPrefsBody = z.object({
  visibility: z.record(z.string(), z.enum(["show", "hide"])).optional(),
  favorite: z.array(z.string()).optional(),
  recent: z.array(z.string()).optional(),
  variant: z.record(z.string(), z.string()).optional(),
})

const UserProviderControlBody = z.object({
  enabled_providers: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
})

const ProviderControlBody = UserProviderControlBody.extend({
  session_model_pool: z
    .array(
      z.object({
        provider_id: z.string().min(1),
        weight: z.number().int().positive(),
        models: z
          .array(
            z.object({
              model_id: z.string().min(1),
              weight: z.number().int().positive(),
            }),
          )
          .min(1),
      }),
    )
    .optional(),
})

const AccountProjectStateLastSession = z.object({
  session_id: z.string().min(1),
  directory: z.string().min(1),
  time_updated: z.number(),
})

const AccountProjectState = z
  .object({
    current_project_id: z.string().optional(),
    last_project_id: z.string().optional(),
    open_project_ids: z.array(z.string()),
    last_session_by_project: z.record(z.string(), AccountProjectStateLastSession),
    workspace_mode_by_project: z.record(z.string(), z.boolean()),
    workspace_order_by_project: z.record(z.string(), z.array(z.string())),
    workspace_expanded_by_directory: z.record(z.string(), z.boolean()),
    workspace_alias_by_project_branch: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .meta({ ref: "AccountProjectState" })

const AccountProjectStatePatch = z.object({
  last_project_id: z.string().nullable().optional(),
  open_project_ids: z.array(z.string()).optional(),
  last_session_by_project: z.record(z.string(), AccountProjectStateLastSession).optional(),
  workspace_mode_by_project: z.record(z.string(), z.boolean()).optional(),
  workspace_order_by_project: z.record(z.string(), z.array(z.string())).optional(),
  workspace_expanded_by_directory: z.record(z.string(), z.boolean()).optional(),
  workspace_alias_by_project_branch: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

const AccountAdminUser = z
  .object({
    id: z.string(),
    username: z.string(),
    display_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    vho_user_id: z.string().optional(),
    status: z.string(),
    account_type: z.string(),
    org_id: z.string(),
    department_id: z.string().optional(),
    customer_id: z.string().optional(),
    customer_name: z.string().optional(),
    customer_department_id: z.string().optional(),
    customer_department_name: z.string().optional(),
    force_password_reset: z.boolean(),
    last_login_at: z.number().optional(),
    last_login_ip: z.string().optional(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  })
  .meta({ ref: "AccountAdminUser" })

const AccountAdminUserPage = z
  .object({
    items: z.array(AccountAdminUser),
    total: z.number(),
    page: z.number(),
    page_size: z.number(),
  })
  .meta({ ref: "AccountAdminUserPage" })

function requireLogin(c: Context) {
  const user_id = c.get("account_user_id") as string | undefined
  if (!user_id) return c.json({ error: "unauthorized" }, 401)
  return user_id
}

function forbidUserProviderConfig() {
  return {
    error: "forbidden" as const,
    permission: "provider:config_global",
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

function requirePlanUse(c: Context) {
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!permissions) return
  if (permissions.includes("agent:use_plan")) return
  return c.json(
    {
      ok: false as const,
      code: "forbidden" as const,
      permission: "agent:use_plan",
    },
    403,
  )
}

/** 中文注释：校验当前用户是否具备 Build 权限。 */
function requireBuildUse(c: Context) {
  const roles = c.get("account_roles" as never) as string[] | undefined
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!UserRbac.canUseBuild({ roles, permissions })) {
    return c.json(
      {
        error: "forbidden",
        permission: "agent:use_build",
      },
      403,
    )
  }
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
        description: "Register a new account for TpCode account system.",
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .post(
      "/login/vho",
      describeRoute({
        summary: "VHO login",
        description: "Login with VHO login type and phone user id.",
        operationId: "account.login.vho",
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
          user_id: z.string(),
          login_type: z.string(),
        }),
      ),
      async (c) => {
        await UserService.ensureSeedOnce()
        const body = c.req.valid("json")
        const result = await UserService.loginVho({
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
      "/context/products",
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        return c.json(await AccountContextService.listProducts({ user_id, context_project_id }))
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
    .get(
      "/context/state",
      describeRoute({
        summary: "Current account project UI state",
        description: "Get the database-backed, account-scoped project UI state.",
        operationId: "account.context.state",
        responses: {
          200: {
            description: "Project state",
            content: {
              "application/json": {
                schema: resolver(AccountProjectState),
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
        return c.json(await AccountProjectStateService.get({ user_id, current_project_id: context_project_id }))
      },
    )
    .patch(
      "/context/state",
      describeRoute({
        summary: "Update current account project UI state",
        description: "Patch the database-backed, account-scoped project UI state.",
        operationId: "account.context.state.update",
        responses: {
          200: {
            description: "Project state",
            content: {
              "application/json": {
                schema: resolver(AccountProjectState),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AccountProjectStatePatch),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        const body = c.req.valid("json")
        return c.json(
          await AccountProjectStateService.update({
            user_id,
            current_project_id: context_project_id,
            patch: body,
          }),
        )
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .post(
      "/plan/save",
      describeRoute({
        summary: "Save plan",
        description: "Persist plan agent output into account plan records.",
        operationId: "account.plan.save",
        responses: {
          200: {
            description: "Saved",
            content: {
              "application/json": {
                schema: resolver(PlanSaveSuccess),
              },
            },
          },
          400: {
            description: "Validation failed",
            content: {
              "application/json": {
                schema: resolver(PlanSaveFailure),
              },
            },
          },
          403: {
            description: "Forbidden",
            content: {
              "application/json": {
                schema: resolver(PlanSaveFailure),
              },
            },
          },
          404: {
            description: "Not found",
            content: {
              "application/json": {
                schema: resolver(PlanSaveFailure),
              },
            },
          },
          502: {
            description: "Upstream sync failed",
            content: {
              "application/json": {
                schema: resolver(PlanSaveFailure),
              },
            },
          },
        },
      }),
      validator("json", PlanSaveBody),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requirePlanUse(c)
        if (denied) return denied
        const body = c.req.valid("json")
        const user = c.get("account_user" as never) as z.infer<typeof LoginResult.shape.user> | undefined
        if (!user) return c.json({ error: "unauthorized" }, 401)
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        const result = await PlanService.save({
          session_id: body.session_id,
          message_id: body.message_id,
          part_id: body.part_id,
          project_id: body.project_id,
          vho_feedback_no: body.vho_feedback_no,
          actor: {
            ...user,
            context_project_id,
          },
        })
        if (!result.ok) {
          const status =
            result.code === "project_forbidden"
              ? 403
              : result.code === "session_missing" || result.code === "message_missing" || result.code === "project_missing"
                ? 404
                : 400
          return c.json({ ...result, error_code: result.code }, status)
        }
        UserService.auditLater({
          actor_user_id: user_id,
          action: "plan.save",
          target_type: "tp_saved_plan",
          target_id: result.id,
          result: "success",
          detail_json: {
            plan_id: result.id,
            session_id: result.session_id,
            message_id: result.message_id,
            part_id: result.part_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .post(
      "/plan/eval/:plan_id/retry",
      describeRoute({
        summary: "Retry saved plan evaluation",
        description: "Retry a failed or skipped saved plan quality evaluation.",
        operationId: "account.plan.eval.retry",
        responses: {
          200: {
            description: "Retry scheduled",
            content: {
              "application/json": {
                schema: resolver(PlanEvalRetrySuccess),
              },
            },
          },
          400: {
            description: "Retry invalid",
            content: {
              "application/json": {
                schema: resolver(PlanEvalRetryFailure),
              },
            },
          },
          403: {
            description: "Forbidden",
            content: {
              "application/json": {
                schema: resolver(PlanEvalRetryFailure),
              },
            },
          },
          404: {
            description: "Not found",
            content: {
              "application/json": {
                schema: resolver(PlanEvalRetryFailure),
              },
            },
          },
        },
      }),
      validator("param", z.object({ plan_id: z.string().min(1) })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requirePlanUse(c)
        if (denied) return denied
        const plan_id = c.req.valid("param").plan_id
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        const result = await PlanEvalService.retry({
          plan_id,
          actor_user_id: user_id,
          context_project_id,
        })
        if (!result.ok) {
          const status = result.code === "forbidden"
            ? 403
            : result.code === "plan_eval_missing" || result.code === "plan_eval_plan_missing"
              ? 404
              : 400
          return c.json(result, status)
        }
        UserService.auditLater({
          actor_user_id: user_id,
          action: "plan.eval.retry",
          target_type: "tp_saved_plan",
          target_id: plan_id,
          result: "success",
          detail_json: { plan_id },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .get(
      "/plan/eval/:plan_id",
      describeRoute({
        summary: "Get saved plan evaluation",
        description: "Get saved plan evaluation detail, including model judge request and response debug payload.",
        operationId: "account.plan.eval.get",
        responses: {
          200: {
            description: "Evaluation detail",
            content: {
              "application/json": {
                schema: resolver(PlanEvalDetailSuccess),
              },
            },
          },
          403: {
            description: "Forbidden",
            content: {
              "application/json": {
                schema: resolver(PlanEvalDetailFailure),
              },
            },
          },
          404: {
            description: "Not found",
            content: {
              "application/json": {
                schema: resolver(PlanEvalDetailFailure),
              },
            },
          },
        },
      }),
      validator("param", z.object({ plan_id: z.string().min(1) })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requirePlanUse(c)
        if (denied) return denied
        const plan_id = c.req.valid("param").plan_id
        const result = await PlanEvalService.get({
          plan_id,
          actor_user_id: user_id,
        })
        if (!result.ok) {
          const status = result.code === "forbidden" ? 403 : 404
          return c.json(result, status)
        }
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
        const state = await AccountProviderState.load(user_id)
        const auth = AccountProviderState.auth(state, param.provider_id)
        const source = AccountProviderState.authSource(state, param.provider_id)
        return c.json({
          provider_id: param.provider_id,
          configured: source !== "none",
          source,
          auth_type: auth?.type,
        })
      },
    )
    .put(
      "/me/provider/:provider_id",
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", Auth.Info),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await AccountUserProviderSettingService.setProviderAuth(user_id, param.provider_id, body)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.set",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
            auth_type: body.type,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/me/provider/:provider_id",
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        await AccountUserProviderSettingService.removeProviderAuth(user_id, param.provider_id)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.remove",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .get(
      "/me/providers/catalog",
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const roles = (c.get("account_roles" as never) as string[] | undefined) ?? []
        const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
        const state = await AccountProviderState.load(user_id)
        const self = UserRbac.canUseBuild({ roles, permissions })
          ? await AccountUserProviderSettingService.providerCatalog(user_id)
          : { rows: {}, control: {}, providers: [] }
        return c.json({
          rows: self.rows,
          providers: self.providers,
          user_control: UserRbac.canUseBuild({ roles, permissions }) ? state.user_control : {},
          global_control: state.global_control,
          user_providers: self.providers,
          selectable_models: UserRbac.canUseBuild({ roles, permissions })
            ? state.selectable_models
            : state.selectable_models.filter((item) => item.source !== "user"),
        })
      },
    )
    .get(
      "/me/provider-control",
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const roles = (c.get("account_roles" as never) as string[] | undefined) ?? []
        const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
        const control = UserRbac.canUseBuild({ roles, permissions })
          ? await AccountUserProviderSettingService.providerControl(user_id)
          : await AccountSystemSettingService.providerControl()
        return c.json({
          model: control.model,
          small_model: control.small_model,
          enabled_providers: control.enabled_providers,
          disabled_providers: control.disabled_providers,
        })
      },
    )
    .put(
      "/me/provider-control",
      validator("json", UserProviderControlBody),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const body = c.req.valid("json")
        const valid = await AccountUserProviderSettingService.validateProviderControl(user_id, body)
        if (!valid.ok) return c.json(valid, 400)
        await AccountUserProviderSettingService.setProviderControl(user_id, valid.value)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.control.update",
          target_type: "user",
          target_id: "provider_control",
          result: "success",
          detail_json: valid.value,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .get(
      "/me/providers/:provider_id/config",
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const config = await AccountUserProviderSettingService.providerConfig(user_id, param.provider_id)
        return c.json({ provider_id: param.provider_id, config: config ?? null })
      },
    )
    .put(
      "/me/providers/:provider_id/config",
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", Config.Provider),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await AccountUserProviderSettingService.setProviderConfig(user_id, param.provider_id, body)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.config.update",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/me/providers/:provider_id/config",
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        await AccountUserProviderSettingService.removeProviderConfig(user_id, param.provider_id)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.config.remove",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .patch(
      "/me/providers/:provider_id/disabled",
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", z.object({ disabled: z.boolean() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await AccountUserProviderSettingService.setProviderDisabled(user_id, param.provider_id, body.disabled)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.disabled.update",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
            disabled: body.disabled,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/me/providers/:provider_id",
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const user_id = requireLogin(c)
        if (typeof user_id !== "string") return user_id
        const denied = requireBuildUse(c)
        if (denied) return denied
        const param = c.req.valid("param")
        await AccountUserProviderSettingService.removeProvider(user_id, param.provider_id)
        await UserService.audit({
          actor_user_id: user_id,
          action: "account.provider.self.delete",
          target_type: "user",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .get(
      "/me/model-prefs",
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .put(
      "/me/model-prefs",
      validator("json", ModelPrefsBody),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .get(
      "/admin/roles",
      UserRbac.require("role:manage"),
      validator(
        "query",
        z.object({
          page: z.coerce.number().int().min(1).optional(),
          page_size: z.coerce.number().int().min(1).max(500).optional(),
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
    .post(
      "/admin/roles",
      UserRbac.require("role:manage"),
      validator(
        "json",
        z.object({
          code: z.string(),
          name: z.string(),
          scope: z.enum(["system", "org"]).optional(),
          description: z.string().optional(),
          permission_codes: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        await UserService.ensureSeed()
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await UserService.createRole({
          ...body,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .delete(
      "/admin/roles/:role_code",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const result = await UserService.deleteRole({
          role_code: param.role_code,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
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
      "/admin/products",
      UserRbac.require("role:manage"),
      async (c) => c.json(await AccountProductService.list()),
    )
    .post(
      "/admin/products",
      UserRbac.require("role:manage"),
      validator(
        "json",
        z.object({
          name: z.string(),
          directory: z.string(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const result = await AccountProductService.create({
          name: body.name,
          directory: body.directory,
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.product.create",
          target_type: "tp_product",
          target_id: result.item.id,
          result: "success",
          detail_json: {
            name: result.item.name,
            project_id: result.item.project_id,
            worktree: result.item.worktree,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        return c.json(result)
      },
    )
    .patch(
      "/admin/products/:product_id",
      UserRbac.require("role:manage"),
      validator("param", z.object({ product_id: z.string() })),
      validator(
        "json",
        z.object({
          name: z.string().optional(),
          directory: z.string().optional(),
        }),
      ),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await AccountProductService.update({
          product_id: param.product_id,
          name: body.name,
          directory: body.directory,
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.product.update",
          target_type: "tp_product",
          target_id: param.product_id,
          result: "success",
          detail_json: {
            name: result.item.name,
            project_id: result.item.project_id,
            worktree: result.item.worktree,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        AccountContextService.invalidateProjectAccess()
        return c.json(result)
      },
    )
    .delete(
      "/admin/products/:product_id",
      UserRbac.require("role:manage"),
      validator("param", z.object({ product_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const result = await AccountProductService.remove(param.product_id)
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.product.delete",
          target_type: "tp_product",
          target_id: param.product_id,
          result: "success",
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        AccountContextService.invalidateProjectAccess()
        return c.json(result)
      },
    )
    .get(
      "/admin/roles/:role_code/products",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      async (c) => {
        const param = c.req.valid("param")
        const result = await AccountProductService.roleProducts(param.role_code)
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .put(
      "/admin/roles/:role_code/products",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      validator("json", z.object({ product_ids: z.array(z.string()) })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await AccountProductService.setRoleProducts({
          role_code: param.role_code,
          product_ids: body.product_ids,
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        await UserService.audit({
          actor_user_id,
          action: "account.role.products.update",
          target_type: "tp_role",
          target_id: param.role_code,
          result: "success",
          detail_json: {
            product_ids: body.product_ids,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        AccountContextService.invalidateProjectAccess()
        return c.json(result)
      },
    )
    .get(
      "/admin/roles/:role_code/projects",
      UserRbac.require("role:manage"),
      validator("param", z.object({ role_code: z.string() })),
      async (c) => {
        const param = c.req.valid("param")
        const result = await AccountContextService.roleProjects(param.role_code)
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .get("/admin/provider/global", UserRbac.requireRole("super_admin"), async (c) =>
      c.json(await AccountSystemSettingService.providerRows()),
    )
    .get("/admin/providers/catalog/global", UserRbac.requireRole("super_admin"), async (c) =>
      c.json(await AccountSystemSettingService.providerCatalog()),
    )
    .put(
      "/admin/provider/:provider_id/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", Auth.Info),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await AccountSystemSettingService.setProviderAuth(param.provider_id, body)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.set",
          target_type: "system",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
            auth_type: body.type,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/admin/provider/:provider_id/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        await AccountSystemSettingService.removeProviderAuth(param.provider_id)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.remove",
          target_type: "system",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/admin/providers/:provider_id/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        await AccountSystemSettingService.removeProvider(param.provider_id)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.delete",
          target_type: "system",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .get("/admin/provider-control/global", UserRbac.requireRole("super_admin"), async (c) =>
      c.json(await AccountSystemSettingService.providerControl()),
    )
    .put(
      "/admin/provider-control/global",
      UserRbac.requireRole("super_admin"),
      validator("json", ProviderControlBody),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const body = c.req.valid("json")
        const valid = await AccountSystemSettingService.validateProviderControl(body)
        if (!valid.ok) return c.json(valid, 400)
        await AccountSystemSettingService.setProviderControl(valid.value)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.control.update",
          target_type: "system",
          target_id: "provider_control",
          result: "success",
          detail_json: valid.value,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .get(
      "/admin/providers/:provider_id/config/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const param = c.req.valid("param")
        const config = await AccountSystemSettingService.providerConfig(param.provider_id)
        return c.json({ provider_id: param.provider_id, config: config ?? null })
      },
    )
    .put(
      "/admin/providers/:provider_id/config/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      validator("json", Config.Provider),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        await AccountSystemSettingService.setProviderConfig(param.provider_id, body)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.config.update",
          target_type: "system",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
        return c.json(true)
      },
    )
    .delete(
      "/admin/providers/:provider_id/config/global",
      UserRbac.requireRole("super_admin"),
      validator("param", z.object({ provider_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        await AccountSystemSettingService.removeProviderConfig(param.provider_id)
        await UserService.audit({
          actor_user_id,
          action: "account.provider.global.config.remove",
          target_type: "system",
          target_id: param.provider_id,
          result: "success",
          detail_json: {
            provider_id: param.provider_id,
          },
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        await AccountProviderState.invalidate()
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
      describeRoute({
        summary: "List admin users",
        description: "List users for TpCode account administration.",
        operationId: "account.admin.users.list",
        responses: {
          200: {
            description: "Users",
            content: {
              "application/json": {
                schema: resolver(z.union([z.array(AccountAdminUser), AccountAdminUserPage])),
              },
            },
          },
          ...errors(400),
        },
      }),
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
          page_size: z.coerce.number().int().min(1).max(500).optional(),
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .delete(
      "/admin/users/:user_id",
      UserRbac.require("user:manage"),
      validator("param", z.object({ user_id: z.string() })),
      async (c) => {
        const actor_user_id = requireLogin(c)
        if (typeof actor_user_id !== "string") return actor_user_id
        const param = c.req.valid("param")
        const result = await UserService.deleteUser({
          user_id: param.user_id,
          actor_user_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    )
    .get(
      "/admin/users/:user_id/providers",
      validator("param", z.object({ user_id: z.string() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .put(
      "/admin/users/:user_id/providers/:provider_id",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      validator("json", Auth.Info),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .delete(
      "/admin/users/:user_id/providers/:provider_id",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .get(
      "/admin/users/:user_id/provider-control",
      validator("param", z.object({ user_id: z.string() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .put(
      "/admin/users/:user_id/provider-control",
      validator("param", z.object({ user_id: z.string() })),
      validator("json", UserProviderControlBody),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .get(
      "/admin/users/:user_id/providers/:provider_id/config",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .put(
      "/admin/users/:user_id/providers/:provider_id/config",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      validator("json", Config.Provider),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .patch(
      "/admin/users/:user_id/providers/:provider_id/disabled",
      validator("param", z.object({ user_id: z.string(), provider_id: z.string() })),
      validator("json", z.object({ disabled: z.boolean() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .get(
      "/admin/users/:user_id/model-prefs",
      validator("param", z.object({ user_id: z.string() })),
      async (c) => c.json(forbidUserProviderConfig(), 403),
    )
    .put(
      "/admin/users/:user_id/model-prefs",
      validator("param", z.object({ user_id: z.string() })),
      validator("json", ModelPrefsBody),
      async (c) => c.json(forbidUserProviderConfig(), 403),
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
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
        if (!result.ok) return c.json({ ...result, error_code: "code" in result ? result.code : undefined }, 400)
        return c.json(result)
      },
    ),
)
