import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

async function headers(app: ReturnType<typeof Server.App>) {
  const login = await app.request("/account/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
    }),
  })
  const output = new Headers({ "Content-Type": "application/json" })
  if (login.status !== 200) return output
  const body = (await login.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  if (!token) return output
  output.set("authorization", `Bearer ${token}`)
  return output
}

describe("tui.selectSession endpoint", () => {
  test("should return 200 when called with valid session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const app = Server.App()
        const auth = await headers(app)
        const created = await app.request(`/session?directory=${encodeURIComponent(projectRoot)}`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ title: "select-test" }),
        })
        expect(created.status).toBe(200)
        const createdBody = (await created.json()) as Record<string, unknown>
        const sessionID = typeof createdBody.id === "string" ? createdBody.id : ""
        expect(sessionID.length > 0).toBe(true)

        // #when
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ sessionID }),
        })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        await Session.remove(sessionID)
      },
    })
  })

  test("should return 404 when session does not exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const nonExistentSessionID = "ses_nonexistent123"

        // #when
        const app = Server.App()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: await headers(app),
          body: JSON.stringify({ sessionID: nonExistentSessionID }),
        })

        // #then
        expect(response.status).toBe(404)
      },
    })
  })

  test("should return 400 when session ID format is invalid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const invalidSessionID = "invalid_session_id"

        // #when
        const app = Server.App()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: await headers(app),
          body: JSON.stringify({ sessionID: invalidSessionID }),
        })

        // #then
        expect(response.status).toBe(400)
      },
    })
  })
})
