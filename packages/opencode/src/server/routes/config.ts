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

const log = Log.create({ service: "server" })

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
                schema: resolver(Config.Info),
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
        })
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update TpCode configuration settings and preferences.",
        operationId: "config.update",
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
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        if (Flag.TPCODE_ACCOUNT_ENABLED) {
          const managed = (
            ["provider", "model", "small_model", "enabled_providers", "disabled_providers"] as const
          ).some((key) => key in config)
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
          const roles = (c.get("account_roles" as never) as string[] | undefined) ?? []
          const superAdmin = roles.includes("super_admin")
          if (!superAdmin) {
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
        }
        return c.json({
          providers: Object.values(scoped),
          default: mapValues(scoped, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
