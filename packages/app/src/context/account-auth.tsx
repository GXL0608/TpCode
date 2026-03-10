import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { useServer } from "./server"
import { usePlatform } from "./platform"
import { ACCOUNT_UNAUTHORIZED_EVENT, AccountToken } from "@/utils/account-auth"

type User = {
  id: string
  username: string
  display_name: string
  account_type: string
  org_id: string
  department_id?: string
  force_password_reset: boolean
  context_project_id?: string
  roles: string[]
  permissions: string[]
  feedback_enabled: boolean
}

type ContextProject = {
  id: string
  name?: string
  worktree: string
  vcs?: string
  selected: boolean
  last_selected: boolean
}

type ContextProduct = {
  id: string
  name?: string
  project_id: string
  worktree: string
  vcs?: string
  selected: boolean
  last_selected: boolean
}

export type AccountProjectStateLastSession = {
  session_id: string
  directory: string
  time_updated: number
}

export type AccountProjectState = {
  current_project_id?: string
  last_project_id?: string
  open_project_ids: string[]
  last_session_by_project: Record<string, AccountProjectStateLastSession>
  workspace_mode_by_project: Record<string, boolean>
  workspace_order_by_project: Record<string, string[]>
  workspace_expanded_by_directory: Record<string, boolean>
  workspace_alias_by_project_branch: Record<string, Record<string, string>>
}

export type AccountProjectStatePatch = Partial<Omit<AccountProjectState, "current_project_id">> & {
  last_project_id?: string | null
}

type LoginResult = {
  access_token: string
  refresh_token: string
  access_expires_at: number
  refresh_expires_at: number
  user: User
}

type RegisterInput = {
  username: string
  password: string
  display_name?: string
  phone: string
}

type SavePlanInput = {
  session_id: string
  message_id: string
  part_id?: string
  vho_feedback_no?: string
}

type SavePlanResult =
  | {
      ok: true
      id: string
      saved_at: number
      session_id: string
      message_id: string
      part_id: string
    }
  | {
      ok: false
      code: string
      message?: string
    }

function json<T>(input: unknown): T | undefined {
  if (!input || typeof input !== "object") return
  return input as T
}

function isJSON(response?: Response) {
  if (!response) return false
  const type = response.headers.get("content-type")?.toLowerCase() ?? ""
  return type.includes("application/json")
}

function invalidAPIResponse() {
  return new Response(JSON.stringify({ error: "account_api_invalid_response" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  })
}

export const { use: useAccountAuth, provider: AccountAuthProvider } = createSimpleContext({
  name: "AccountAuth",
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const [state, setState] = createStore({
      ready: false,
      enabled: false,
      user: undefined as User | undefined,
      last_error: undefined as string | undefined,
    })

    const fetcher = platform.fetch ?? globalThis.fetch

    const current = () => server.current
    const url = (path: string) => {
      const item = current()
      if (!item) return
      return new URL(path, item.http.url).toString()
    }

    const request = async (input: {
      path: string
      method?: string
      body?: Record<string, unknown>
      auth?: "optional" | "required" | "none"
    }) => {
      const endpoint = url(input.path)
      if (!endpoint) throw new Error("server_missing")
      const send = (auth?: string) => {
        const headers = new Headers()
        headers.set("content-type", "application/json")
        if (auth) headers.set("authorization", `Bearer ${auth}`)
        headers.set("accept", "application/json")
        return fetcher(endpoint, {
          method: input.method ?? "GET",
          headers,
          body: input.body ? JSON.stringify(input.body) : undefined,
        })
      }
      const token = input.auth === "none" ? undefined : AccountToken.access()
      const response = await send(token)
      if (response.status === 401 && input.auth !== "none") {
        const replaced = AccountToken.replacedAccess(token)
        if (replaced) {
          const retry = await send(replaced)
          if (retry.ok && !isJSON(retry)) return invalidAPIResponse()
          return retry
        }
        const refreshed = await AccountToken.refreshIfNeeded({
          baseUrl: current()?.http.url ?? endpoint,
          fetcher,
        })
        const access = refreshed ?? AccountToken.replacedAccess(token)
        if (access) {
          const retry = await send(access)
          if (retry.ok && !isJSON(retry)) return invalidAPIResponse()
          return retry
        }
      }
      if (response.ok && !isJSON(response)) return invalidAPIResponse()
      return response
    }

    const responseCode = async (response?: Response) => {
      if (!response) return
      const payload = json<{ code?: string; error?: string }>(await response.json().catch(() => undefined))
      return payload?.code ?? payload?.error
    }

    const writeSession = (result: LoginResult) => {
      AccountToken.setTokens(result)
      setState("enabled", true)
      setState("user", result.user)
      setState("last_error", undefined)
    }

    const clearSession = () => {
      AccountToken.clear()
      setState("user", undefined)
    }

    const refresh = async () => {
      const refresh_token = AccountToken.refresh()
      if (!refresh_token) return false
      const response = await request({
        path: "/account/token/refresh",
        method: "POST",
        body: { refresh_token },
        auth: "none",
      }).catch(() => undefined)
      if (!response) return false
      if (response.status === 404) return false
      if (!response.ok) return false
      const result = json<LoginResult>(await response.json().catch(() => undefined))
      if (!result?.access_token || !result.refresh_token || !result.user) return false
      writeSession(result)
      return true
    }

    const probe = async () => {
      setState("ready", false)
      const me = await request({
        path: "/account/me",
        method: "GET",
        auth: "optional",
      }).catch(() => undefined)
      if (!me) {
        setState("enabled", false)
        setState("ready", true)
        return
      }
      if (me.status === 404) {
        setState("enabled", false)
        clearSession()
        setState("ready", true)
        return
      }
      if (me.ok) {
        const user = json<User>(await me.json().catch(() => undefined))
        setState("enabled", true)
        setState("user", user)
        setState("ready", true)
        return
      }
      if (me.status === 401) {
        setState("enabled", true)
        const ok = await refresh()
        if (!ok) clearSession()
        setState("ready", true)
        return
      }
      setState("enabled", false)
      setState("ready", true)
    }

    const bootstrap = async () => {
      const item = current()
      if (!item) {
        setState("enabled", false)
        setState("ready", true)
        return
      }
      await probe()
    }

    createEffect(() => {
      server.key
      void bootstrap()
    })

    createEffect(() => {
      if (typeof window === "undefined") return
      const onUnauthorized = () => {
        setState("enabled", true)
        clearSession()
        setState("ready", true)
      }
      window.addEventListener(ACCOUNT_UNAUTHORIZED_EVENT, onUnauthorized)
      onCleanup(() => {
        window.removeEventListener(ACCOUNT_UNAUTHORIZED_EVENT, onUnauthorized)
      })
    })

    return {
      ready: createMemo(() => state.ready),
      enabled: createMemo(() => state.enabled),
      authenticated: createMemo(() => !!state.user),
      needsProjectContext: createMemo(() => {
        if (!state.enabled || !state.user) return false
        if (state.user.context_project_id) return false
        return !state.user.permissions.includes("role:manage")
      }),
      user: createMemo(() => state.user),
      lastError: createMemo(() => state.last_error),
      has(permission: string) {
        if (!state.enabled) return true
        const user = state.user
        if (!user) return false
        return user.permissions.includes(permission)
      },
      async reload() {
        await bootstrap()
      },
      async login(input: { username: string; password: string }) {
        const response = await request({
          path: "/account/login",
          method: "POST",
          body: input,
          auth: "none",
        })
        if (response.status === 404) {
          setState("enabled", false)
          setState("last_error", "account_disabled")
          return false
        }
        if (!response.ok) {
          setState("enabled", true)
          setState("last_error", (await responseCode(response)) ?? "login_failed")
          return false
        }
        const result = json<LoginResult>(await response.json().catch(() => undefined))
        if (!result?.access_token || !result.refresh_token || !result.user) {
          setState("last_error", "login_failed")
          return false
        }
        writeSession(result)
        setState("ready", true)
        return true
      },
      async loginVho(input: { userId: string; loginType: string }) {
        const response = await request({
          path: "/account/login/vho",
          method: "POST",
          body: {
            user_id: input.userId,
            login_type: input.loginType,
          },
          auth: "none",
        })
        if (response.status === 404) {
          setState("enabled", false)
          setState("last_error", "account_disabled")
          return false
        }
        if (!response.ok) {
          setState("enabled", true)
          setState("last_error", (await responseCode(response)) ?? "vho_login_failed")
          return false
        }
        const result = json<LoginResult>(await response.json().catch(() => undefined))
        if (!result?.access_token || !result.refresh_token || !result.user) {
          setState("last_error", "vho_login_failed")
          return false
        }
        writeSession(result)
        setState("ready", true)
        return true
      },
      async register(input: RegisterInput) {
        const response = await request({
          path: "/account/register",
          method: "POST",
          body: input,
          auth: "none",
        })
        if (response.status === 404) {
          setState("enabled", false)
          setState("last_error", "account_disabled")
          return false
        }
        if (!response.ok) {
          setState("enabled", true)
          setState("last_error", (await responseCode(response)) ?? "register_failed")
          return false
        }
        setState("last_error", undefined)
        return true
      },
      async forgotRequest(input: { username: string }) {
        const response = await request({
          path: "/account/password/forgot/request",
          method: "POST",
          body: input,
          auth: "none",
        })
        if (!response.ok) return
        const result = json<{ reset_code?: string }>(await response.json().catch(() => undefined))
        return result?.reset_code
      },
      async forgotReset(input: { username: string; code: string; new_password: string }) {
        const response = await request({
          path: "/account/password/forgot/reset",
          method: "POST",
          body: input,
          auth: "none",
        })
        return response.ok
      },
      async changePassword(input: { current_password: string; new_password: string }) {
        const response = await request({
          path: "/account/password/change",
          method: "POST",
          body: input,
          auth: "required",
        })
        if (response.ok) {
          setState("user", (user) => {
            if (!user) return user
            return {
              ...user,
              force_password_reset: false,
            }
          })
          return { ok: true as const }
        }
        const body = json<{ code?: string; error?: string }>(await response.json().catch(() => undefined))
        return {
          ok: false as const,
          code: body?.code ?? body?.error ?? "password_change_failed",
        }
      },
      async logout() {
        await request({
          path: "/account/logout",
          method: "POST",
          auth: "required",
        }).catch(() => undefined)
        clearSession()
        setState("last_error", undefined)
      },
      async logoutAll() {
        await request({
          path: "/account/logout-all",
          method: "POST",
          auth: "required",
        }).catch(() => undefined)
        clearSession()
        setState("last_error", undefined)
      },
      async savePlan(input: SavePlanInput): Promise<SavePlanResult> {
        const call = () =>
          request({
            path: "/account/plan/save",
            method: "POST",
            body: input,
            auth: "required",
          }).catch(() => undefined)
        let response = await call()
        if (response?.status === 401) {
          const ok = await refresh()
          if (ok) response = await call()
        }
        if (!response?.ok) {
          const body = json<{ ok?: boolean; code?: string; error?: string; message?: string }>(
            await response?.json().catch(() => undefined),
          )
          if (body?.ok === false && body.code) {
            return {
              ok: false,
              code: body.code,
              message: body.message,
            }
          }
          return {
            ok: false,
            code: body?.code ?? body?.error ?? "plan_save_failed",
          }
        }
        const body = json<SavePlanResult>(await response.json().catch(() => undefined))
        if (!body) {
          return {
            ok: false,
            code: "plan_save_failed",
          }
        }
        if (!body.ok) return body
        if (!body.id || !body.saved_at || !body.session_id || !body.message_id || !body.part_id) {
          return {
            ok: false,
            code: "plan_save_failed",
          }
        }
        return body
      },
      async contextProjects() {
        const response = await request({
          path: "/account/context/projects",
          method: "GET",
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) {
          setState("last_error", (await responseCode(response)) ?? "context_projects_failed")
          return
        }
        const payload = json<{
          current_project_id?: string
          last_project_id?: string
          projects: ContextProject[]
        }>(await response.json().catch(() => undefined))
        if (!payload) {
          setState("last_error", "context_projects_failed")
          return
        }
        return payload
      },
      async contextProducts() {
        const response = await request({
          path: "/account/context/products",
          method: "GET",
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) {
          setState("last_error", (await responseCode(response)) ?? "context_products_failed")
          return
        }
        const payload = json<{
          current_project_id?: string
          last_project_id?: string
          products: ContextProduct[]
        }>(await response.json().catch(() => undefined))
        if (!payload) {
          setState("last_error", "context_products_failed")
          return
        }
        return payload
      },
      async contextState() {
        const response = await request({
          path: "/account/context/state",
          method: "GET",
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) {
          setState("last_error", (await responseCode(response)) ?? "context_state_failed")
          return
        }
        const payload = json<AccountProjectState>(await response.json().catch(() => undefined))
        if (!payload) {
          setState("last_error", "context_state_failed")
          return
        }
        return payload
      },
      async updateContextState(input: AccountProjectStatePatch) {
        const response = await request({
          path: "/account/context/state",
          method: "PATCH",
          body: input,
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) {
          setState("last_error", (await responseCode(response)) ?? "context_state_update_failed")
          return
        }
        const payload = json<AccountProjectState>(await response.json().catch(() => undefined))
        if (!payload) {
          setState("last_error", "context_state_update_failed")
          return
        }
        return payload
      },
      async selectContext(project_id: string) {
        const response = await request({
          path: "/account/context/select",
          method: "POST",
          body: { project_id },
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) {
          const code = await responseCode(response)
          setState("last_error", code ?? "context_select_failed")
          return {
            ok: false as const,
            code: code ?? "context_select_failed",
          }
        }
        const result = json<LoginResult>(await response.json().catch(() => undefined))
        if (!result?.access_token || !result.refresh_token || !result.user) {
          setState("last_error", "context_select_failed")
          return {
            ok: false as const,
            code: "context_select_failed",
          }
        }
        writeSession(result)
        return {
          ok: true as const,
        }
      },
    }
  },
})
