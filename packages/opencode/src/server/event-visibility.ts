import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"

type Event = {
  type: string
  properties: Record<string, unknown>
}

export function eventSessionID(event: Event) {
  const props = event.properties
  if (typeof props.sessionID === "string") return props.sessionID
  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    const info = props.info
    if (info && typeof info === "object") {
      const id = (info as Record<string, unknown>).id
      if (typeof id === "string") return id
    }
    return
  }
  if (event.type === "message.updated") {
    const info = props.info
    if (info && typeof info === "object") {
      const sessionID = (info as Record<string, unknown>).sessionID
      if (typeof sessionID === "string") return sessionID
    }
    return
  }
  if (event.type === "message.part.updated") {
    const part = props.part
    if (part && typeof part === "object") {
      const sessionID = (part as Record<string, unknown>).sessionID
      if (typeof sessionID === "string") return sessionID
    }
    return
  }
  return
}

export function eventProjectID(event: Event) {
  if (event.type === "project.updated") {
    const id = event.properties.id
    if (typeof id === "string") return id
    return
  }
  const projectID = event.properties.projectID
  if (typeof projectID === "string") return projectID
  const info = event.properties.info
  if (info && typeof info === "object") {
    const value = (info as Record<string, unknown>).projectID
    if (typeof value === "string") return value
  }
  return
}

export async function eventVisibleToUser(input: { event: Event; userID?: string; cache?: Map<string, boolean>; projectID?: string }) {
  if (!input.userID && !input.projectID) return true
  const sessionID = eventSessionID(input.event)
  if (!sessionID) return true
  const cached = input.cache?.get(sessionID)
  if (cached !== undefined) return cached
  const row = await Database.use((db) =>
    db
      .select({
        user_id: SessionTable.user_id,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get(),
  )
  const visible = !!row?.user_id && row.user_id === input.userID
  input.cache?.set(sessionID, visible)
  return visible
}
