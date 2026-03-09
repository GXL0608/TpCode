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
import { AccountCurrent } from "@/user/current"
import { AccountProviderState } from "@/provider/account-provider-state"

function requireProviderConfig(c: Context) {
  if (Flag.TPCODE_ACCOUNT_ENABLED) {
    return c.json(
      {
        error: "forbidden",
        permission: "provider:config_global|provider:config_user",
      },
      403,
    )
  }
  const permissions = c.get("account_permissions" as never) as string[] | undefined
  if (!permissions) {
    return c.json(
      {
        error: "forbidden",
        permission: "provider:config_own",
      },
      403,
    )
  }
  if (permissions.includes("provider:config_own")) return
  return c.json(
    {
      error: "forbidden",
      permission: "provider:config_own",
    },
    403,
  )
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

        const strictAccount = Flag.TPCODE_ACCOUNT_ENABLED
        const config = strictAccount ? undefined : await Config.get()
        const uid = strictAccount ? AccountCurrent.optional()?.user_id : undefined
        const account = strictAccount && uid ? await AccountProviderState.load(uid) : undefined
        const user = account?.user
        const disabled = new Set(strictAccount ? (account?.control.disabled_providers ?? []) : (config?.disabled_providers ?? []))
        if (strictAccount) {
          for (const [providerID, item] of Object.entries(user?.providers ?? {})) {
            if (item.meta.flags?.disabled) disabled.add(providerID)
          }
        }
        const enabled = strictAccount
          ? (account?.control.enabled_providers ? new Set(account.control.enabled_providers) : undefined)
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
        })
        if (Flag.TPCODE_ACCOUNT_ENABLED) {
          await AccountProviderState.invalidate()
        }
        return c.json(true)
      },
    ),
)
