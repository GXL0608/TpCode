import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const app = Server.App()
const on = Flag.TPCODE_ACCOUNT_ENABLED

beforeAll(async () => {
  await app.fetch(new Request("http://localhost/global/health"))
  if (!on) return
  const { UserService } = await import("../../src/user/service")
  await UserService.ensureSeed()
})

beforeEach(async () => {
  await resetDatabase()
})

describe("prototype routes", () => {
  test.skipIf(on)("uploads, lists and reads prototype files", async () => {
    await using dir = await tmpdir()
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII="

    const created = await app.request(`/session?directory=${encodeURIComponent(dir.path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "prototype-route-session",
      }),
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as { id: string }

    const uploaded = await app.request(`/session/${session.id}/prototype/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Prototype",
        page_key: "prototype-page",
        route: "/prototype",
        filename: "prototype.png",
        content_type: "image/png",
        data_base64: png,
      }),
    })
    expect(uploaded.status).toBe(200)
    const saved = (await uploaded.json()) as {
      ok: boolean
      prototype: {
        id: string
        version: number
      }
    }
    expect(saved.ok).toBe(true)
    expect(saved.prototype.version).toBe(1)

    const listed = await app.request(`/session/${session.id}/prototype`)
    expect(listed.status).toBe(200)
    const list = (await listed.json()) as {
      items: Array<{ id: string }>
    }
    expect(list.items.length).toBe(1)

    const file = await app.request(`/prototype/${saved.prototype.id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get("content-type")).toBe("image/png")
    expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  test.skipIf(on)("uploads prototype into target session when saved_plan_id carries target session id", async () => {
    await using dir = await tmpdir()
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII="

    const first = await app.request(`/session?directory=${encodeURIComponent(dir.path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "prototype-route-current",
      }),
    })
    expect(first.status).toBe(200)
    const current = (await first.json()) as { id: string }

    const second = await app.request(`/session?directory=${encodeURIComponent(dir.path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "prototype-route-target",
      }),
    })
    expect(second.status).toBe(200)
    const target = (await second.json()) as { id: string }

    const uploaded = await app.request(`/session/${current.id}/prototype/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        saved_plan_id: target.id,
        title: "Prototype From Saved Plan",
        page_key: "saved-plan-page",
        route: "/saved-plan",
        filename: "prototype.png",
        content_type: "image/png",
        data_base64: png,
      }),
    })
    expect(uploaded.status).toBe(200)
    const saved = (await uploaded.json()) as {
      ok: boolean
      prototype: {
        session_id: string
      }
    }
    expect(saved.ok).toBe(true)
    expect(saved.prototype.session_id).toBe(target.id)

    const listed = await app.request(`/session/${target.id}/prototype`)
    expect(listed.status).toBe(200)
    const list = (await listed.json()) as {
      items: Array<{ session_id: string }>
    }
    expect(list.items.length).toBe(1)
    expect(list.items[0]?.session_id).toBe(target.id)
  })
})
