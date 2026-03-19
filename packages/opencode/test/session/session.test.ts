import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        const received = [] as Session.Info[]

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          received.push(event.properties.info as Session.Info)
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        const own = received.find((item) => item.id === session.id)
        expect(own).toBeDefined()
        expect(own?.projectID).toBe(session.projectID)
        expect(own?.directory).toBe(session.directory)
        expect(own?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })

  test("deleting a session keeps the row as soft deleted and hides it from lookups", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const before = [] as Session.Info[]
        for await (const item of Session.listGlobal({ archived: true, limit: 200 })) {
          before.push(item)
        }
        expect(before.some((item) => item.id === session.id)).toBe(true)

        await Session.remove(session.id)

        const stored = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get())
        expect(stored?.time_deleted).toBeNumber()

        await expect(Session.get(session.id)).rejects.toThrow("NotFoundError")

        const after = [] as Session.Info[]
        for await (const item of Session.listGlobal({ archived: true, limit: 200 })) {
          after.push(item)
        }
        expect(after.some((item) => item.id === session.id)).toBe(false)
      },
    })
  })
})
