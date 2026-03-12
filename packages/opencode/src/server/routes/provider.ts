import { Hono, type Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Flag } from "@/flag/flag"
import { AccountSystemSettingService } from "@/user/system-setting"
import { AccountProviderState } from "@/provider/account-provider-state"
import { UserRbac } from "@/user/rbac"

/** 中文注释：读取当前请求的 provider 配置作用域。 */
function providerScope(c: Context) {
  return c.req.query("scope") === "global" ? "global" : "self"
}

/** 中文注释：判断当前用户是否具备 Build 权限。 */
function canUseBuild(c: Context) {
  const roles = c.get("account_roles" as never) as string[] | undefined
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  return UserRbac.canUseBuild({ roles, permissions })
}

/** 中文注释：校验当前请求是否允许修改 provider 配置。 */
function requireProviderConfig(c: Context) {
  if (!Flag.TPCODE_ACCOUNT_ENABLED) return
  if (Flag.TPCODE_ACCOUNT_ENABLED) {
    const scope = providerScope(c)
    const permissions = c.get("account_permissions" as never) as string[] | undefined
    const roles = c.get("account_roles" as never) as string[] | undefined
    if (scope === "global" && roles?.includes("super_admin")) return
    if (scope === "self" && UserRbac.canUseBuild({ roles, permissions })) return
    return c.json(
      {
        error: "forbidden",
        permission: scope === "global" ? "provider:config_global" : "agent:use_build",
      },
      403,
    )
  }
}

/** 中文注释：为 Build 权限用户构建合并后的可见模型目录。 */
async function managedProviders(user_id: string) {
  const [state, connected] = await Promise.all([AccountProviderState.load(user_id), Provider.list()])
  const map = new Map<string, z.infer<typeof Provider.Info>>()
  for (const item of state.selectable_models) {
    const provider = connected[item.provider_id]
    const model = provider?.models[item.model_id]
    if (!provider || !model) continue
    const current = map.get(provider.id) ?? {
      ...provider,
      models: {},
    }
    current.models[model.id] = model
    map.set(provider.id, current)
  }
  const all = [...map.values()]
  return {
    all,
    default: mapValues(Object.fromEntries(all.map((item) => [item.id, item])), (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
    connected: all.map((item) => item.id),
  }
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const allProviders = await ModelsDev.get()
        const connected = await Provider.list()
        const user_id = c.get("account_user_id" as never) as string | undefined

        const strictAccount = Flag.TPCODE_ACCOUNT_ENABLED
        if (strictAccount) {
          if (user_id && canUseBuild(c)) {
            const scoped = await managedProviders(user_id)
            return c.json(scoped)
          }
          const current = await Provider.defaultModel().catch(() => undefined)
          if (!current) {
            return c.json({
              all: [],
              default: {},
              connected: [],
            })
          }
          const provider = connected[current.providerID]
          const model = provider?.models[current.modelID]
          if (!provider || !model) {
            return c.json({
              all: [],
              default: {},
              connected: [],
            })
          }
          const scoped = {
            ...provider,
            models: {
              [model.id]: model,
            },
          }
          return c.json({
            all: [scoped],
            default: {
              [scoped.id]: model.id,
            },
            connected: [scoped.id],
          })
        }
        const config = strictAccount ? undefined : await Config.get()
        const control = strictAccount ? await AccountSystemSettingService.providerControl() : undefined
        const disabled = new Set(strictAccount ? (control?.disabled_providers ?? []) : (config?.disabled_providers ?? []))
        const enabled = strictAccount
          ? (control?.enabled_providers ? new Set(control.enabled_providers) : undefined)
          : (config?.enabled_providers ? new Set(config.enabled_providers) : undefined)

        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        const connectedIDs = Object.keys(connected)
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: connectedIDs.filter((id) => providers[id] !== undefined),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator("query", z.object({ scope: z.enum(["self", "global"]).optional() })),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const denied = requireProviderConfig(c)
        if (denied) return denied
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
          scope: c.req.valid("query").scope,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator("query", z.object({ scope: z.enum(["self", "global"]).optional() })),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const denied = requireProviderConfig(c)
        if (denied) return denied
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
          scope: c.req.valid("query").scope,
        })
        return c.json(true)
      },
    ),
)
