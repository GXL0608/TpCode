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
}

type ContextProject = {
  id: string
  name?: string
  worktree: string
  vcs?: string
  selected: boolean
  last_selected: boolean
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

function json<T>(input: unknown): T | undefined {
  if (!input || typeof input !== "object") return
  return input as T
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
      const headers = new Headers()
      headers.set("content-type", "application/json")
      if (input.auth !== "none") {
        const token = AccountToken.access()
        if (token) headers.set("authorization", `Bearer ${token}`)
      }
      return fetcher(endpoint, {
        method: input.method ?? "GET",
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
      })
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
      needsProjectContext: createMemo(() => state.enabled && !!state.user && !state.user.context_project_id),
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
      async contextProjects() {
        const response = await request({
          path: "/account/context/projects",
          method: "GET",
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) return
        const payload = json<{
          current_project_id?: string
          last_project_id?: string
          projects: ContextProject[]
        }>(await response.json().catch(() => undefined))
        return payload
      },
      async selectContext(project_id: string) {
        const response = await request({
          path: "/account/context/select",
          method: "POST",
          body: { project_id },
          auth: "required",
        }).catch(() => undefined)
        if (!response?.ok) return false
        const result = json<LoginResult>(await response.json().catch(() => undefined))
        if (!result?.access_token || !result.refresh_token || !result.user) return false
        writeSession(result)
        return true
      },
    }
  },
})
