import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"
import { Log } from "../util/log"

export namespace Todo {
  const log = Log.create({ service: "session.todo" })

  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export async function update(input: { sessionID: string; todos: Info[] }) {
    await Database.transaction(async (db) => {
      await db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      await db.insert(TodoTable)
        .values(
          input.todos.map((todo, position) => ({
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
          })),
        )
        .run()
    })
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string) {
    const started = Date.now()
    const rows = await Database.use((db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
    )
    const result = rows.map((row) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
    log.info("get", {
      event: "session.todo.get",
      session_id: sessionID,
      duration_ms: Date.now() - started,
      todo_count: result.length,
    })
    return result
  }
}
