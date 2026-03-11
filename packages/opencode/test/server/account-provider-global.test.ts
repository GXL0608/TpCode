import { beforeAll, describe, expect, test } from "bun:test"
import { AccountSystemSettingService } from "../../src/user/system-setting"
import { Flag } from "../../src/flag/flag"

const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED

const state = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
}

async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App() }
}

async function req(input: {
  path: string
  method?: string
  token?: string
  body?: Record<string, unknown>
}) {
  const app = state.app
  if (!app) throw new Error("app_missing")
  const headers = new Headers()
  if (input.token) headers.set("authorization", `Bearer ${input.token}`)
  if (input.body) headers.set("content-type", "application/json")
  return app.request(input.path, {
    method: input.method ?? "GET",
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
}

async function login(username: string, password: string) {
  const response = await req({
    path: "/account/login",
    method: "POST",
    body: { username, password },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : ""
  expect(token).toBeTruthy()
  return token
}

beforeAll(async () => {
  if (!accountEnabled) return
  const ready = await boot()
  state.app = ready.app
})

describe("account global provider management", () => {
  test.skipIf(!accountEnabled)("catalog returns all configured providers and their models", async () => {
    const admin = await login("admin", "TpCode@2026")
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
        },
      })
      await AccountSystemSettingService.setProviderAuth("anthropic", {
        type: "api",
        key: "sk-anthropic",
      })
      await AccountSystemSettingService.setProviderConfig("anthropic", {
        models: {
          "claude-sonnet-4-20250514": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        model: "openai/gpt-5.2-chat-latest",
        small_model: "anthropic/claude-sonnet-4-20250514",
        enabled_providers: ["openai", "anthropic"],
      })

      const response = await req({
        path: "/account/admin/providers/catalog/global",
        token: admin,
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        providers?: Array<{ provider_id: string; models: Array<{ model_id: string }> }>
        control?: { model?: string; small_model?: string; enabled_providers?: string[] }
      }

      expect(body.providers?.map((item) => item.provider_id)).toEqual(
        expect.arrayContaining(["anthropic", "openai"]),
      )
      expect(body.providers?.find((item) => item.provider_id === "openai")?.models.map((item) => item.model_id)).toEqual(
        expect.arrayContaining(["gpt-5.2-chat-latest"]),
      )
      expect(body.providers?.find((item) => item.provider_id === "anthropic")?.models.map((item) => item.model_id)).toEqual(
        expect.arrayContaining(["claude-sonnet-4-20250514"]),
      )
      expect(body.control).toEqual({
        model: "openai/gpt-5.2-chat-latest",
        small_model: "anthropic/claude-sonnet-4-20250514",
        enabled_providers: ["openai", "anthropic"],
      })
    } finally {
      await AccountSystemSettingService.setProviderControl(control)
      for (const providerID of Object.keys(await AccountSystemSettingService.providerAuths())) {
        if (auths[providerID]) continue
        await AccountSystemSettingService.removeProviderAuth(providerID)
      }
      for (const [providerID, auth] of Object.entries(auths)) {
        await AccountSystemSettingService.setProviderAuth(providerID, auth)
      }
      for (const providerID of Object.keys(await AccountSystemSettingService.providerConfigs())) {
        if (configs[providerID]) continue
        await AccountSystemSettingService.removeProviderConfig(providerID)
      }
      for (const [providerID, config] of Object.entries(configs)) {
        await AccountSystemSettingService.setProviderConfig(providerID, config)
      }
    }
  })

  test.skipIf(!accountEnabled)("provider control rejects model outside configured providers", async () => {
    const admin = await login("admin", "TpCode@2026")
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        enabled_providers: ["openai"],
      })

      const response = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "anthropic/claude-sonnet-4-20250514",
          enabled_providers: ["openai"],
        },
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { code?: string }
      expect(body.code).toBe("provider_not_configured")
    } finally {
      await AccountSystemSettingService.setProviderControl(control)
      for (const providerID of Object.keys(await AccountSystemSettingService.providerAuths())) {
        if (auths[providerID]) continue
        await AccountSystemSettingService.removeProviderAuth(providerID)
      }
      for (const [providerID, auth] of Object.entries(auths)) {
        await AccountSystemSettingService.setProviderAuth(providerID, auth)
      }
      for (const providerID of Object.keys(await AccountSystemSettingService.providerConfigs())) {
        if (configs[providerID]) continue
        await AccountSystemSettingService.removeProviderConfig(providerID)
      }
      for (const [providerID, config] of Object.entries(configs)) {
        await AccountSystemSettingService.setProviderConfig(providerID, config)
      }
    }
  })

  test.skipIf(!accountEnabled)("deleting configured provider clears auth config and control references", async () => {
    const admin = await login("admin", "TpCode@2026")
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        model: "openai/gpt-5.2-chat-latest",
        small_model: "openai/gpt-5.2-chat-latest",
        enabled_providers: ["openai"],
        disabled_providers: ["openai"],
      })

      const response = await req({
        path: "/account/admin/providers/openai/global",
        method: "DELETE",
        token: admin,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toBe(true)
      expect(await AccountSystemSettingService.providerAuth("openai")).toBeUndefined()
      expect(await AccountSystemSettingService.providerConfig("openai")).toBeUndefined()
      expect(await AccountSystemSettingService.providerControl()).toEqual({})
    } finally {
      await AccountSystemSettingService.setProviderControl(control)
      for (const providerID of Object.keys(await AccountSystemSettingService.providerAuths())) {
        if (auths[providerID]) continue
        await AccountSystemSettingService.removeProviderAuth(providerID)
      }
      for (const [providerID, auth] of Object.entries(auths)) {
        await AccountSystemSettingService.setProviderAuth(providerID, auth)
      }
      for (const providerID of Object.keys(await AccountSystemSettingService.providerConfigs())) {
        if (configs[providerID]) continue
        await AccountSystemSettingService.removeProviderConfig(providerID)
      }
      for (const [providerID, config] of Object.entries(configs)) {
        await AccountSystemSettingService.setProviderConfig(providerID, config)
      }
    }
  })
})
