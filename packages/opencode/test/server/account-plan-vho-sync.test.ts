import { beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"

const root = path.join(__dirname, "../..")
Log.init({ print: false })
const on = Flag.TPCODE_ACCOUNT_ENABLED

async function boot() {
  const { Server } = await import("../../src/server/server")
  return Server.App()
}

const mem = {
  app: undefined as Awaited<ReturnType<typeof boot>> | undefined,
}

async function req(path: string) {
  const app = mem.app
  if (!app) throw new Error("app_missing")
  return Instance.provide({
    directory: root,
    fn: () => app.request(path, { method: "GET" }),
  })
}

beforeAll(async () => {
  if (!on) return
  mem.app = await boot()
})

describe("account plan vho sync", () => {
  test.skipIf(!on)("requires password query", async () => {
    const response = await req("/account/admin/plan/vho-sync")

    expect(response.status).toBe(400)
  })

  test.skipIf(!on)("rejects non-production environment", async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = "test"

    const response = await req("/account/admin/plan/vho-sync?password=2026888")

    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
    expect(response.status).toBe(403)
  })

  test.skipIf(!on)("rejects wrong password", async () => {
    const response = await req("/account/admin/plan/vho-sync?password=wrong")

    expect(response.status).toBe(403)
  })

  test.skipIf(!on)("rejects production mode when database is not the production target", async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = "production"

    const response = await req("/account/admin/plan/vho-sync?password=2026888")

    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
    expect(response.status).toBe(403)
  })
})
