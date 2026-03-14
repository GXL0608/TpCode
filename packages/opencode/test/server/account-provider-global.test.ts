import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { AccountSystemSettingService } from "../../src/user/system-setting"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"

const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED
const root = path.join(__dirname, "../..")

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

  test.skipIf(!accountEnabled)("provider control persists session model pool in provider_control_json", async () => {
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
          "gpt-4.1-mini": {},
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

      const pool = [
        {
          provider_id: "openai",
          weight: 3,
          models: [
            { model_id: "gpt-5.2-chat-latest", weight: 4 },
            { model_id: "gpt-4.1-mini", weight: 1 },
          ],
        },
        {
          provider_id: "anthropic",
          weight: 1,
          models: [{ model_id: "claude-sonnet-4-20250514", weight: 2 }],
        },
      ]

      const update = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "openai/gpt-5.2-chat-latest",
          small_model: "openai/gpt-4.1-mini",
          enabled_providers: ["openai", "anthropic"],
          session_model_pool: pool,
        },
      })

      expect(update.status).toBe(200)
      expect(await update.json()).toBe(true)

      const response = await req({
        path: "/account/admin/provider-control/global",
        token: admin,
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        model?: string
        small_model?: string
        enabled_providers?: string[]
        session_model_pool?: unknown
      }

      expect(body.model).toBe("openai/gpt-5.2-chat-latest")
      expect(body.small_model).toBe("openai/gpt-4.1-mini")
      expect(body.enabled_providers).toEqual(["openai", "anthropic"])
      expect(body.session_model_pool).toEqual(pool)
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

  test.skipIf(!accountEnabled)("provider control persists mirror model and exposes it from managed endpoints", async () => {
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
          "gpt-4.1-mini": {},
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

      const update = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "openai/gpt-5.2-chat-latest",
          small_model: "openai/gpt-4.1-mini",
          enabled_providers: ["openai", "anthropic"],
          mirror_model: {
            provider_id: "anthropic",
            model_id: "claude-sonnet-4-20250514",
          },
        },
      })

      expect(update.status).toBe(200)
      expect(await update.json()).toBe(true)

      const [controlResponse, catalogResponse, selfCatalogResponse, configResponse] = await Promise.all([
        req({
          path: "/account/admin/provider-control/global",
          token: admin,
        }),
        req({
          path: "/account/admin/providers/catalog/global",
          token: admin,
        }),
        req({
          path: "/account/me/providers/catalog",
          token: admin,
        }),
        req({
          path: "/config",
          token: admin,
        }),
      ])

      expect(controlResponse.status).toBe(200)
      expect(catalogResponse.status).toBe(200)
      expect(selfCatalogResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const controlBody = (await controlResponse.json()) as {
        mirror_model?: unknown
      }
      const catalogBody = (await catalogResponse.json()) as {
        control?: {
          mirror_model?: unknown
        }
      }
      const selfCatalogBody = (await selfCatalogResponse.json()) as {
        global_control?: {
          mirror_model?: unknown
        }
      }
      const configBody = (await configResponse.json()) as {
        mirror_model?: unknown
      }

      expect(controlBody.mirror_model).toEqual({
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-20250514",
      })
      expect(catalogBody.control?.mirror_model).toEqual({
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-20250514",
      })
      expect(selfCatalogBody.global_control?.mirror_model).toEqual({
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-20250514",
      })
      expect(configBody.mirror_model).toEqual({
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-20250514",
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

  test.skipIf(!accountEnabled)("provider control rejects mirror model on disabled provider", async () => {
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

      const response = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "openai/gpt-5.2-chat-latest",
          enabled_providers: ["openai"],
          disabled_providers: ["anthropic"],
          mirror_model: {
            provider_id: "anthropic",
            model_id: "claude-sonnet-4-20250514",
          },
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

  test.skipIf(!accountEnabled)("provider control rejects invalid session model pool weights and duplicates", async () => {
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
          "gpt-4.1-mini": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        enabled_providers: ["openai"],
      })

      const duplicateProvider = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "openai/gpt-5.2-chat-latest",
          enabled_providers: ["openai"],
          session_model_pool: [
            {
              provider_id: "openai",
              weight: 1,
              models: [{ model_id: "gpt-5.2-chat-latest", weight: 1 }],
            },
            {
              provider_id: "openai",
              weight: 2,
              models: [{ model_id: "gpt-4.1-mini", weight: 1 }],
            },
          ],
        },
      })

      expect(duplicateProvider.status).toBe(400)

      const badWeight = await req({
        path: "/account/admin/provider-control/global",
        method: "PUT",
        token: admin,
        body: {
          model: "openai/gpt-5.2-chat-latest",
          enabled_providers: ["openai"],
          session_model_pool: [
            {
              provider_id: "openai",
              weight: 0,
              models: [{ model_id: "gpt-5.2-chat-latest", weight: 1 }],
            },
          ],
        },
      })

      expect(badWeight.status).toBe(400)
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

  test.skipIf(!accountEnabled)("provider control requires fallback model when session model pool is configured", async () => {
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
          enabled_providers: ["openai"],
          session_model_pool: [
            {
              provider_id: "openai",
              weight: 1,
              models: [{ model_id: "gpt-5.2-chat-latest", weight: 1 }],
            },
          ],
        },
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { code?: string; message?: string }
      expect(body.code).toBe("invalid_provider_control")
      expect(body.message).toContain("model")
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

  test.skipIf(!accountEnabled)("config patch rejects managed session model pool field in strict account mode", async () => {
    const admin = await login("admin", "TpCode@2026")

    const response = await req({
      path: "/config",
      method: "PATCH",
      token: admin,
      body: {
        session_model_pool: [
          {
            provider_id: "openai",
            weight: 1,
            models: [{ model_id: "gpt-4.1-mini", weight: 1 }],
          },
        ],
      },
    })

    expect(response.status).toBe(403)
    const body = (await response.json()) as { reason?: string }
    expect(body.reason).toBe("provider_model_managed_by_global_account_admin")
  })

  test.skipIf(!accountEnabled)("summarize uses the session locked model in strict account mode", async () => {
    const admin = await login("admin", "TpCode@2026")
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()
    const random = spyOn(Math, "random")
    const stream = spyOn(LLM, "stream").mockImplementation(async () => {
      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "text-start" }
          yield { type: "text-delta", text: "summary" }
          yield { type: "text-end" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
            },
          }
          yield { type: "finish" }
        })(),
        text: Promise.resolve("summary"),
        totalUsage: Promise.resolve(undefined),
        providerMetadata: Promise.resolve(undefined),
      } as unknown as Awaited<ReturnType<typeof LLM.stream>>
    })

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-5.2-chat-latest": {},
          "gpt-4.1-mini": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        model: "openai/gpt-4.1-mini",
        enabled_providers: ["openai"],
        session_model_pool: [
          {
            provider_id: "openai",
            weight: 1,
            models: [
              { model_id: "gpt-5.2-chat-latest", weight: 3 },
              { model_id: "gpt-4.1-mini", weight: 1 },
            ],
          },
        ],
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const projects = await req({
            path: "/account/context/projects",
            token: admin,
          })
          expect(projects.status).toBe(200)
          const body = (await projects.json()) as {
            projects?: Array<{ id: string; worktree: string }>
          }
          const project = body.projects?.[0]
          expect(project?.id).toBeTruthy()
          expect(project?.worktree).toBeTruthy()
          if (!project?.id || !project.worktree) throw new Error("project_missing")

          const selected = await req({
            path: "/account/context/select",
            method: "POST",
            token: admin,
            body: { project_id: project.id },
          })
          expect(selected.status).toBe(200)
          const selectedBody = (await selected.json()) as { access_token?: string }
          expect(selectedBody.access_token).toBeTruthy()
          if (!selectedBody.access_token) throw new Error("context_token_missing")

          random.mockReturnValue(0.1)
          const created = await req({
            path: `/session?directory=${encodeURIComponent(project.worktree)}`,
            method: "POST",
            token: selectedBody.access_token,
            body: { title: "summary-lock-test" },
          })

          expect(created.status).toBe(200)
          const session = (await created.json()) as { id?: string }
          if (!session.id) throw new Error("session_id_missing")

          try {
            const message = await SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "hello" }],
            })
            if (message.info.role !== "user") throw new Error("user_message_missing")
            expect(message.info.model).toEqual({
              providerID: "openai",
              modelID: "gpt-5.2-chat-latest",
            })

            const response = await req({
              path: `/session/${session.id}/summarize`,
              method: "POST",
              token: selectedBody.access_token,
              body: { auto: false },
            })

            expect(response.status).toBe(200)
            const msgs = await Session.messages({ sessionID: session.id })
            const summary = msgs.findLast((item) => item.info.role === "user" && item.parts.some((part) => part.type === "compaction"))
            if (!summary || summary.info.role !== "user") throw new Error("summary_message_missing")
            expect(summary.info.model).toEqual({
              providerID: "openai",
              modelID: "gpt-5.2-chat-latest",
            })
          } finally {
            await Session.remove(session.id)
          }
        },
      })
    } finally {
      stream.mockRestore()
      random.mockRestore()
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
