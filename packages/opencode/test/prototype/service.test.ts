import { beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { PrototypeService } from "../../src/prototype/service"
import { Session } from "../../src/session"
import { Filesystem } from "../../src/util/filesystem"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import path from "path"

beforeEach(async () => {
  await resetDatabase()
})

describe("prototype service", () => {
  test("keeps only the latest prototype inside one session when page keys differ", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      async fn() {
        const session = await Session.create({ title: "prototype-session" })
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII=",
          "base64",
        )

        const first = await PrototypeService.upload({
          actor: {},
          session_id: session.id,
          title: "Queue Page",
          page_key: "queue-page",
          route: "/queue",
          filename: "queue.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(first.ok).toBe(true)
        if (!first.ok) return
        expect(first.prototype.version).toBe(1)
        expect(first.prototype.is_latest).toBe(true)

        const second = await PrototypeService.upload({
          actor: {},
          session_id: session.id,
          title: "Doctor Page",
          page_key: "doctor-page",
          route: "/doctor",
          filename: "doctor.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(second.ok).toBe(true)
        if (!second.ok) return
        expect(second.prototype.version).toBe(1)
        expect(second.prototype.is_latest).toBe(true)

        const list = await PrototypeService.listBySession({
          session_id: session.id,
        })
        expect(list.length).toBe(1)
        expect(list[0]?.version).toBe(1)
        expect(list[0]?.is_latest).toBe(true)
        expect(list[0]?.title).toBe("Doctor Page")
        expect(list[0]?.page_key).toBe("doctor-page")

        const old = await PrototypeService.file(first.prototype.id)
        expect(old).toBeUndefined()

        const file = await PrototypeService.file(second.prototype.id)
        expect(!!file).toBe(true)
        expect(file?.mime).toBe("image/png")
        expect(file?.size_bytes).toBeGreaterThan(0)
      },
    })
  })

  test("replaces previous prototype and keeps version history for the same page key", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      async fn() {
        const session = await Session.create({ title: "prototype-session" })
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII=",
          "base64",
        )

        const first = await PrototypeService.upload({
          actor: {},
          session_id: session.id,
          title: "Queue Page",
          page_key: "queue-page",
          route: "/queue",
          filename: "queue.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(first.ok).toBe(true)
        if (!first.ok) return

        const second = await PrototypeService.upload({
          actor: {},
          session_id: session.id,
          title: "Queue Page v2",
          page_key: "queue-page",
          route: "/queue",
          filename: "queue-2.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(second.ok).toBe(true)
        if (!second.ok) return
        expect(second.prototype.version).toBe(2)

        const list = await PrototypeService.listBySession({
          session_id: session.id,
        })
        expect(list.length).toBe(1)
        expect(list[0]?.title).toBe("Queue Page v2")
        expect(list[0]?.version).toBe(2)

        const old = await PrototypeService.file(first.prototype.id)
        expect(old).toBeUndefined()
      },
    })
  })

  test("uploads prototype into overridden session when saved_plan_id carries target session id", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      async fn() {
        const current = await Session.create({ title: "current-session" })
        const target = await Session.create({ title: "target-session" })
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII=",
          "base64",
        )

        const result = await PrototypeService.upload({
          actor: {},
          session_id: target.id,
          title: "Saved Plan Page",
          page_key: "saved-plan-page",
          route: "/saved-plan",
          filename: "saved-plan.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.prototype.session_id).toBe(target.id)

        const list = await PrototypeService.listBySession({
          session_id: target.id,
        })
        expect(list.length).toBe(1)
        expect(list[0]?.session_id).toBe(target.id)
      },
    })
  })

  test("removing a prototype also clears its parent folder", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      async fn() {
        const session = await Session.create({ title: "prototype-session" })
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZJr4AAAAASUVORK5CYII=",
          "base64",
        )

        const result = await PrototypeService.upload({
          actor: {},
          session_id: session.id,
          title: "Queue Page",
          page_key: "queue-page",
          route: "/queue",
          filename: "queue.png",
          content_type: "image/png",
          data_base64: png.toString("base64"),
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const pageDir = path.join(dir.path, ".opencode", "prototypes", session.id, "queue-page")
        expect(await Filesystem.exists(pageDir)).toBe(true)

        const removed = await PrototypeService.remove({
          id: result.prototype.id,
        })
        expect(removed.ok).toBe(true)
        expect(await Filesystem.exists(pageDir)).toBe(false)
      },
    })
  })
})
