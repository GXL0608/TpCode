import path from "path"
import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
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

describe("session voice route", () => {
  test("returns stored audio bytes and mime", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const auth = await headers(app)

        const created = await app.request(`/session?directory=${encodeURIComponent(projectRoot)}`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ title: "voice-route-test" }),
        })
        expect(created.status).toBe(200)

        const createdBody = (await created.json()) as Record<string, unknown>
        const sessionID = typeof createdBody.id === "string" ? createdBody.id : ""
        expect(sessionID.length > 0).toBe(true)

        const payload = Buffer.from("voice-route", "utf-8").toString("base64")
        const sent = await app.request(`/session/${sessionID}/message`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            noReply: true,
            agent: "build",
            parts: [
              {
                type: "text",
                text: "route voice",
              },
              {
                type: "file",
                mime: "audio/webm",
                filename: "route.webm",
                url: `data:audio/webm;base64,${payload}`,
                forModel: false,
              },
            ],
          }),
        })
        expect(sent.status).toBe(200)

        const body = JSON.parse(await sent.text()) as {
          parts?: Array<{ type: string; mime?: string; url?: string }>
        }
        const audio = body.parts?.find((part) => part.type === "file" && part.mime?.startsWith("audio/"))

        expect(audio).toBeDefined()
        if (!audio?.url) return

        const voice = await app.request(audio.url, {
          method: "GET",
          headers: auth,
        })
        expect(voice.status).toBe(200)
        expect(voice.headers.get("content-type") ?? "").toContain("audio/webm")

        const bytes = Buffer.from(await voice.arrayBuffer()).toString("utf-8")
        expect(bytes).toBe("voice-route")

        await Session.remove(sessionID)
      },
    })
  })
})
