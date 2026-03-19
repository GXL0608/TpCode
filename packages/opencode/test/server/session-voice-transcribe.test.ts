import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const projectRoot = path.join(__dirname, "../..")

async function headers(app: ReturnType<typeof Server.App>) {
  const login = await app.request("/account/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
    }),
  })
  const out = new Headers({ "Content-Type": "application/json" })
  if (login.status !== 200) return out

  const body = (await login.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  if (!token) return out

  out.set("authorization", `Bearer ${token}`)
  return out
}

describe("session voice transcribe route", () => {
  test("state route does not get intercepted by sessionID middleware", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const auth = await headers(app)
        const response = await app.request(`/session/voice/transcribe/state?directory=${encodeURIComponent(projectRoot)}`, {
          method: "GET",
          headers: auth,
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(typeof body.ready).toBe("boolean")
        expect(typeof body.warming).toBe("boolean")
      },
    })
  })

  test("prewarm route does not get intercepted by sessionID middleware", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const auth = await headers(app)
        const response = await app.request(`/session/voice/transcribe/prewarm?directory=${encodeURIComponent(projectRoot)}`, {
          method: "POST",
          headers: auth,
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(typeof body.queued).toBe("boolean")
        expect(typeof body.ready).toBe("boolean")
        expect(typeof body.warming).toBe("boolean")
      },
    })
  })

  test("does not get intercepted by sessionID middleware", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const auth = await headers(app)
        const payload = Buffer.from("voice-route", "utf-8").toString("base64")

        const response = await app.request(`/session/voice/transcribe?directory=${encodeURIComponent(projectRoot)}`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            mime: "text/plain",
            data_url: `data:text/plain;base64,${payload}`,
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.error).toBe("voice_transcribe_failed")
        expect(String(body.message ?? "")).toContain("Unsupported audio mime type")
      },
    })
  })
})
