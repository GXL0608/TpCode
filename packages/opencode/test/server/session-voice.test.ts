import path from "path"
import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionVoice } from "../../src/session/voice"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const projectRoot = path.join(__dirname, "../..")

async function context(app: ReturnType<typeof Server.App>) {
  const login = await app.request("/account/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026",
    }),
  })
  const headers = new Headers({ "Content-Type": "application/json" })
  if (login.status !== 200) return { headers, directory: projectRoot }

  const body = (await login.json()) as Record<string, unknown>
  const token = typeof body.access_token === "string" ? body.access_token : undefined
  if (!token) return { headers, directory: projectRoot }

  const projects = await app.request("/account/context/projects", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  })
  if (projects.status !== 200) {
    headers.set("authorization", `Bearer ${token}`)
    return { headers, directory: projectRoot }
  }

  const payload = (await projects.json()) as {
    projects?: Array<{ id: string; worktree: string }>
  }
  const project =
    payload.projects?.find((item) => path.resolve(item.worktree) === path.resolve(projectRoot)) ?? payload.projects?.[0]
  if (!project) {
    headers.set("authorization", `Bearer ${token}`)
    return { headers, directory: projectRoot }
  }

  const selected = await app.request("/account/context/select", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project_id: project.id }),
  })
  const next =
    selected.status === 200
      ? ((await selected.json()) as Record<string, unknown>)
      : {}
  const access = typeof next.access_token === "string" ? next.access_token : token
  headers.set("authorization", `Bearer ${access}`)
  return { headers, directory: project.worktree }
}

describe("session voice route", () => {
  test("returns stored audio bytes and mime", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const ctx = await context(app)
        const auth = ctx.headers

        const created = await app.request(`/session?directory=${encodeURIComponent(ctx.directory)}`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ title: "voice-route-test" }),
        })
        expect(created.status).toBe(200)

        const createdBody = (await created.json()) as Record<string, unknown>
        const sessionID = typeof createdBody.id === "string" ? createdBody.id : ""
        expect(sessionID.length > 0).toBe(true)
        const read = await app.request(`/session/${sessionID}?directory=${encodeURIComponent(ctx.directory)}`, {
          method: "GET",
          headers: auth,
        })
        expect(read.status).toBe(200)

        const payload = Buffer.from("voice-route", "utf-8").toString("base64")
        const messageID = Identifier.ascending("message")
        const partID = Identifier.ascending("part")
        await Session.updateMessage({
          id: messageID,
          sessionID,
          role: "user",
          time: {
            created: Date.now(),
          },
          agent: "build",
          model: {
            providerID: "test",
            modelID: "test",
          },
        })
        const audio = await SessionVoice.saveDataFile({
          session_id: sessionID,
          message_id: messageID,
          part_id: partID,
          mime: "audio/webm",
          filename: "route.webm",
          data_url: `data:audio/webm;base64,${payload}`,
          stt_text: "route voice",
        })
        const url = `${SessionVoice.url(sessionID, audio.id)}?directory=${encodeURIComponent(ctx.directory)}`

        const voice = await app.request(url, {
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
