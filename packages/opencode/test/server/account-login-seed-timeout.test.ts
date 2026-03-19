import { beforeAll, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"

Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

const mem = {
  app: undefined as Awaited<ReturnType<typeof init>>["app"] | undefined,
  user: undefined as Awaited<ReturnType<typeof init>>["user"] | undefined,
}

async function init() {
  const [{ Server }, { UserService }] = await Promise.all([
    import("../../src/server/server"),
    import("../../src/user/service"),
  ])
  await UserService.ensureSeed()
  return { app: Server.App(), user: UserService }
}

async function req(input: {
  path: string
  method?: string
  body?: Record<string, unknown>
  signal?: AbortSignal
}) {
  const app = mem.app
  if (!app) throw new Error("app_missing")
  const headers = new Headers()
  if (input.body) headers.set("content-type", "application/json")
  return app.request(input.path, {
    method: input.method ?? "GET",
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: input.signal,
  })
}

beforeAll(async () => {
  if (!on) return
  const ready = await init()
  mem.app = ready.app
  mem.user = ready.user
})

describe("account login seed timeout", () => {
  test.skipIf(!on)("login returns even when account seed warmup stalls", async () => {
    const user = mem.user
    if (!user) throw new Error("user_service_missing")
    const original = user.ensureSeedOnce
    user.ensureSeedOnce = (() => new Promise<void>(() => {})) as typeof user.ensureSeedOnce
    const start = Date.now()
    try {
      const response = await req({
        path: "/account/login",
        method: "POST",
        body: {
          username: "__no_such_user__",
          password: "whatever123",
        },
        signal: AbortSignal.timeout(5000),
      })
      expect(Date.now() - start).toBeLessThan(4500)
      expect(response.status).toBe(400)
      const body = (await response.json()) as Record<string, unknown>
      const code =
        typeof body.code === "string"
          ? body.code
          : typeof body.error_code === "string"
            ? body.error_code
            : typeof body.error === "string"
              ? body.error
              : undefined
      expect(code).toBe("invalid_credentials")
      return
    } finally {
      user.ensureSeedOnce = original
    }
  })
})
