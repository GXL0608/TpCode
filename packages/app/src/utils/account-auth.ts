const ACCESS = "tpcode.account.access_token"
const REFRESH = "tpcode.account.refresh_token"
const ACCESS_EXPIRES = "tpcode.account.access_expires_at"
const REFRESH_EXPIRES = "tpcode.account.refresh_expires_at"
export const ACCOUNT_UNAUTHORIZED_EVENT = "tpcode.account.unauthorized"

let refreshing: Promise<string | undefined> | undefined
const memory = new Map<string, string>()

function get(key: string) {
  const cached = memory.get(key)
  if (cached) return cached
  if (typeof localStorage === "undefined") return
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return
  }
}

function set(key: string, value: string) {
  memory.set(key, value)
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

function remove(key: string) {
  memory.delete(key)
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(key)
  } catch {
    return
  }
}

function emitUnauthorized() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(ACCOUNT_UNAUTHORIZED_EVENT))
}

function toNumber(input?: string) {
  if (!input) return
  const num = Number(input)
  if (!Number.isFinite(num)) return
  return num
}

export namespace AccountToken {
  export function access() {
    return get(ACCESS)
  }

  export function replacedAccess(token?: string) {
    const next = access()
    if (!token || !next || next === token) return
    return next
  }

  export function refresh() {
    return get(REFRESH)
  }

  export function accessExpiresAt() {
    return toNumber(get(ACCESS_EXPIRES))
  }

  export function refreshExpiresAt() {
    return toNumber(get(REFRESH_EXPIRES))
  }

  export function setTokens(input: {
    access_token: string
    refresh_token: string
    access_expires_at?: number
    refresh_expires_at?: number
  }) {
    set(ACCESS, input.access_token)
    set(REFRESH, input.refresh_token)
    if (typeof input.access_expires_at === "number") set(ACCESS_EXPIRES, String(input.access_expires_at))
    if (typeof input.refresh_expires_at === "number") set(REFRESH_EXPIRES, String(input.refresh_expires_at))
  }

  export function clear() {
    remove(ACCESS)
    remove(REFRESH)
    remove(ACCESS_EXPIRES)
    remove(REFRESH_EXPIRES)
  }

  export function handleUnauthorized() {
    clear()
    emitUnauthorized()
  }

  export async function refreshIfNeeded(input: {
    baseUrl: string
    fetcher?: typeof fetch
  }) {
    if (refreshing) return refreshing
    refreshing = (async () => {
      const refresh_token = refresh()
      if (!refresh_token) return
      const endpoint = new URL("/account/token/refresh", input.baseUrl).toString()
      const fetcher = input.fetcher ?? globalThis.fetch
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token }),
      }).catch(() => undefined)
      if (!response?.ok) return
      const body = await response
        .json()
        .catch(() => undefined)
        .then((value) => (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined))
      const access_token = typeof body?.access_token === "string" ? body.access_token : undefined
      const next_refresh_token = typeof body?.refresh_token === "string" ? body.refresh_token : undefined
      if (!access_token || !next_refresh_token) return
      const access_expires_at = typeof body?.access_expires_at === "number" ? body.access_expires_at : undefined
      const refresh_expires_at = typeof body?.refresh_expires_at === "number" ? body.refresh_expires_at : undefined
      setTokens({
        access_token,
        refresh_token: next_refresh_token,
        access_expires_at,
        refresh_expires_at,
      })
      return access_token
    })()
    const result = await refreshing
    refreshing = undefined
    return result
  }
}
