import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Flag } from "@/flag/flag"
import { AccountSystemSettingService } from "@/user/system-setting"
import { AccountProviderState } from "@/provider/account-provider-state"
import { UserRbac } from "@/user/rbac"

const log = Log.create({ service: "server" })
const ManagedSessionModelPool = z
  .array(
    z.object({
      provider_id: z.string(),
      weight: z.number().int().positive(),
      models: z.array(
        z.object({
          model_id: z.string(),
          weight: z.number().int().positive(),
        }),
      ),
    }),
  )
  .optional()
const ManagedConfig = Config.Info.extend({
  session_model_pool: ManagedSessionModelPool,
})
const ConfigPatchBody = Config.Info.catchall(z.unknown())

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current TpCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(ManagedConfig),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json(config)
        const control = await AccountSystemSettingService.providerControl()
        const model = await Provider.defaultModel()
          .then((value) => `${value.providerID}/${value.modelID}`)
          .catch(() => undefined)
        const {
          provider: _provider,
          model: _model,
          small_model: _smallModel,
          enabled_providers: _enabledProviders,
          disabled_providers: _disabledProviders,
          ...rest
        } = config
        return c.json({
          ...rest,
          enabled_providers: control.enabled_providers,
          disabled_providers: control.disabled_providers,
          model,
          small_model: control.small_model,
          session_model_pool: control.session_model_pool,
        })
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update TpCode configuration settings and preferences.",
        operationId: "config.update",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Config",
              },
            },
          },
        },
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ConfigPatchBody),
      async (c) => {
        const raw = c.req.valid("json")
        if (Flag.TPCODE_ACCOUNT_ENABLED) {
          const managed = (
            ["provider", "model", "small_model", "enabled_providers", "disabled_providers", "session_model_pool"] as const
          ).some((key) => key in raw)
          if (managed) {
            return c.json(
              {
                error: "forbidden",
                reason: "provider_model_managed_by_global_account_admin",
              },
              403,
            )
          }
        }
        const config = Config.Info.parse(raw)
        await Config.update(config)
        return c.json(config)
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const scoped = await Provider.list().then((x) => mapValues(x, (item) => item))
        if (Flag.TPCODE_ACCOUNT_ENABLED) {
          const user_id = c.get("account_user_id" as never) as string | undefined
          const roles = (c.get("account_roles" as never) as string[] | undefined) ?? []
          const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
          if (user_id && UserRbac.canUseBuild({ roles, permissions })) {
            const state = await AccountProviderState.load(user_id)
            const map = new Map<string, z.infer<typeof Provider.Info>>()
            for (const item of state.selectable_models) {
              const provider = scoped[item.provider_id]
              const model = provider?.models[item.model_id]
              if (!provider || !model) continue
              const current = map.get(provider.id) ?? {
                ...provider,
                models: {},
              }
              current.models[model.id] = model
              map.set(provider.id, current)
            }
            const providers = [...map.values()]
            return c.json({
              providers,
              default: mapValues(Object.fromEntries(providers.map((item) => [item.id, item])), (item) =>
                Provider.sort(Object.values(item.models))[0]?.id ?? "",
              ),
            })
          }
          const current = await Provider.defaultModel().catch(() => undefined)
          if (!current) {
            return c.json({
              providers: [],
              default: {},
            })
          }
          const provider = scoped[current.providerID]
          const model = provider?.models[current.modelID]
          if (!provider || !model) {
            return c.json({
              providers: [],
              default: {},
            })
          }
          const currentProvider = {
            ...provider,
            models: {
              [model.id]: model,
            },
          }
          return c.json({
            providers: [currentProvider],
            default: {
              [currentProvider.id]: model.id,
            },
          })
        }
        return c.json({
          providers: Object.values(scoped),
          default: mapValues(scoped, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
