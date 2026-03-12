import { beforeAll, describe, expect, test } from "bun:test"
import { AccountSystemSettingService } from "../../src/user/system-setting"
import { Flag } from "../../src/flag/flag"

const accountEnabled = Flag.TPCODE_ACCOUNT_ENABLED

const state = {
  app: undefined as Awaited<ReturnType<typeof boot>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof boot>>["UserService"] | undefined,
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 中文注释：启动测试用服务端和用户服务。 */
async function boot() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), UserService }
}

/** 中文注释：统一发送测试请求。 */
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

/** 中文注释：登录并返回访问令牌。 */
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

/** 中文注释：为当前账号选择可访问项目上下文，并返回切换后的令牌与目录。 */
async function selectContext(token: string) {
  const projects = await req({
    path: "/account/context/projects",
    token,
  })
  expect(projects.status).toBe(200)
  const payload = (await projects.json()) as {
    projects?: Array<{ id: string; worktree: string }>
  }
  const project = payload.projects?.[0]
  expect(!!project?.id).toBe(true)
  expect(!!project?.worktree).toBe(true)
  if (!project?.id || !project.worktree) throw new Error("project_missing")

  const selected = await req({
    path: "/account/context/select",
    method: "POST",
    token,
    body: { project_id: project.id },
  })
  expect(selected.status).toBe(200)
  const body = (await selected.json()) as { access_token?: string }
  expect(!!body.access_token).toBe(true)
  if (!body.access_token) throw new Error("token_missing")
  return {
    token: body.access_token,
    directory: project.worktree,
  }
}

beforeAll(async () => {
  if (!accountEnabled) return
  const ready = await boot()
  state.app = ready.app
  state.user = ready.UserService
})

describe("account user provider setting", () => {
  test.skipIf(!accountEnabled)("build 权限用户可以配置个人 provider、个人模型并看到系统合并候选", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-global-openai",
      })
      await AccountSystemSettingService.setProviderConfig("openai", {
        models: {
          "gpt-4.1-mini": {},
          "gpt-5.2-chat-latest": {},
        },
      })
      await AccountSystemSettingService.setProviderControl({
        enabled_providers: ["openai"],
        model: "openai/gpt-4.1-mini",
        small_model: "openai/gpt-4.1-mini",
        session_model_pool: [
          {
            provider_id: "openai",
            weight: 1,
            models: [{ model_id: "gpt-5.2-chat-latest", weight: 1 }],
          },
        ],
      })

      const username = uid("build_user")
      const password = "TpCode@123A"
      const created = await service.createUser({
        username,
        password,
        display_name: "Build User",
        account_type: "internal",
        org_id: "org_tp_internal",
        role_codes: ["super_admin"],
        actor_user_id: "user_tp_admin",
      })
      expect(created.ok).toBe(true)
      const loginToken = await login(username, password)
      const selected = await selectContext(loginToken)
      const token = selected.token

      const authSave = await req({
        path: "/auth/openrouter",
        method: "PUT",
        token,
        body: { type: "api", key: "sk-user-openrouter" },
      })
      expect(authSave.status).toBe(200)

      const configSave = await req({
        path: "/account/me/providers/openrouter/config",
        method: "PUT",
        token,
        body: {
          models: {
            "openai/gpt-4o-mini": {},
          },
        },
      })
      expect(configSave.status).toBe(200)

      const controlSave = await req({
        path: "/account/me/provider-control",
        method: "PUT",
        token,
        body: {
          enabled_providers: ["openrouter"],
          model: "openrouter/openai/gpt-4o-mini",
          small_model: "openrouter/openai/gpt-4o-mini",
        },
      })
      expect(controlSave.status).toBe(200)

      const own = await req({
        path: "/account/me/provider/openrouter",
        token,
      })
      expect(own.status).toBe(200)
      const ownBody = (await own.json()) as {
        configured?: boolean
        source?: string
        auth_type?: string
      }
      expect(ownBody.configured).toBe(true)
      expect(ownBody.source).toBe("user")
      expect(ownBody.auth_type).toBe("api")

      const ownControl = await req({
        path: "/account/me/provider-control",
        token,
      })
      expect(ownControl.status).toBe(200)
      const ownControlBody = (await ownControl.json()) as {
        model?: string
        small_model?: string
        enabled_providers?: string[]
      }
      expect(ownControlBody.model).toBe("openrouter/openai/gpt-4o-mini")
      expect(ownControlBody.small_model).toBe("openrouter/openai/gpt-4o-mini")
      expect(ownControlBody.enabled_providers).toEqual(["openrouter"])

      const catalog = await req({
        path: "/account/me/providers/catalog",
        token,
      })
      expect(catalog.status).toBe(200)
      const catalogBody = (await catalog.json()) as {
        selectable_models?: Array<{ value: string; source: string }>
        global_control?: { model?: string }
        user_control?: { model?: string }
      }
      expect(catalogBody.global_control?.model).toBe("openai/gpt-4.1-mini")
      expect(catalogBody.user_control?.model).toBe("openrouter/openai/gpt-4o-mini")
      expect(
        (catalogBody.selectable_models ?? []).some(
          (item) => item.value === "openrouter/openai/gpt-4o-mini" && item.source === "user",
        ),
      ).toBe(true)
      expect(
        (catalogBody.selectable_models ?? []).some(
          (item) => item.value === "openai/gpt-4.1-mini" && item.source === "global",
        ),
      ).toBe(true)
      expect(
        (catalogBody.selectable_models ?? []).some(
          (item) => item.value === "openai/gpt-5.2-chat-latest" && item.source === "pool",
        ),
      ).toBe(true)

      const providers = await req({
        path: "/provider",
        token,
      })
      expect(providers.status).toBe(200)
      const providersBody = (await providers.json()) as {
        connected?: string[]
        all?: Array<{ id: string }>
      }
      expect((providersBody.connected ?? []).includes("openrouter")).toBe(true)
      expect((providersBody.connected ?? []).includes("openai")).toBe(true)
      expect((providersBody.all ?? []).some((item) => item.id === "openrouter")).toBe(true)
      expect((providersBody.all ?? []).some((item) => item.id === "openai")).toBe(true)

      const configProviders = await req({
        path: "/config/providers",
        token,
      })
      expect(configProviders.status).toBe(200)
      const configProvidersBody = (await configProviders.json()) as {
        providers?: Array<{ id: string }>
      }
      expect((configProvidersBody.providers ?? []).some((item) => item.id === "openrouter")).toBe(true)
      expect((configProvidersBody.providers ?? []).some((item) => item.id === "openai")).toBe(true)

      const createdSession = await req({
        path: "/session?directory=" + encodeURIComponent(selected.directory),
        method: "POST",
        token,
        body: { title: uid("manual_model_session") },
      })
      expect(createdSession.status).toBe(200)
      const session = (await createdSession.json()) as { id: string }
      expect(session.id).toBeTruthy()

      const setRuntime = await req({
        path: `/session/${encodeURIComponent(session.id)}/runtime-model?directory=${encodeURIComponent(selected.directory)}`,
        method: "PUT",
        token,
        body: {
          providerID: "openrouter",
          modelID: "openai/gpt-4o-mini",
        },
      })
      expect(setRuntime.status).toBe(200)

      const sessionInfo = await req({
        path: `/session/${encodeURIComponent(session.id)}?directory=${encodeURIComponent(selected.directory)}`,
        token,
      })
      expect(sessionInfo.status).toBe(200)
      const sessionBody = (await sessionInfo.json()) as {
        runtime_model?: {
          providerID?: string
          modelID?: string
          source?: string
        }
      }
      expect(sessionBody.runtime_model).toEqual({
        providerID: "openrouter",
        modelID: "openai/gpt-4o-mini",
        source: "manual",
      })

      const promptResponse = await req({
        path: `/session/${encodeURIComponent(session.id)}/message?directory=${encodeURIComponent(selected.directory)}`,
        method: "POST",
        token,
        body: {
          agent: "plan",
          noReply: true,
          parts: [{ type: "text", text: "plan agent should still use manual model" }],
        },
      })
      expect(promptResponse.status).toBe(200)

      const promptBody = JSON.parse(await promptResponse.text()) as {
        info?: {
          role?: string
          agent?: string
          model?: {
            providerID?: string
            modelID?: string
          }
        }
      }
      expect(promptBody.info?.role).toBe("user")
      expect(promptBody.info?.agent).toBe("plan")
      expect(promptBody.info?.model).toEqual({
        providerID: "openrouter",
        modelID: "openai/gpt-4o-mini",
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
  }, 60000)

  test.skipIf(!accountEnabled)("没有 build 权限的用户不能配置个人 provider 和模型", async () => {
    const service = state.user
    if (!service) throw new Error("user_service_missing")
    const username = uid("plan_only")
    const password = "TpCode@123A"
    const created = await service.createUser({
      username,
      password,
      display_name: "Plan Only",
      account_type: "internal",
      org_id: "org_tp_internal",
      role_codes: ["developer"],
      actor_user_id: "user_tp_admin",
    })
    expect(created.ok).toBe(true)
    const token = await login(username, password)

    const authDenied = await req({
      path: "/auth/openai",
      method: "PUT",
      token,
      body: { type: "api", key: "sk-plan-only" },
    })
    expect(authDenied.status).toBe(403)

    const controlDenied = await req({
      path: "/account/me/provider-control",
      method: "PUT",
      token,
      body: { model: "openai/gpt-4.1-mini" },
    })
    expect(controlDenied.status).toBe(403)

    const configDenied = await req({
      path: "/account/me/providers/openai/config",
      method: "PUT",
      token,
      body: {
        models: {
          "gpt-4.1-mini": {},
        },
      },
    })
    expect(configDenied.status).toBe(403)
  })
})
