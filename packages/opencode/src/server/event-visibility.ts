import { SessionTable } from "@/session/session.sql"
import { Database, eq, inArray } from "@/storage/db"

type Event = {
  type: string
  properties: Record<string, unknown>
}

const DEFAULT_VISIBILITY_CACHE_LIMIT = 512

export type EventVisibilityCache = {
  get: (session_id: string) => boolean | undefined
  set: (session_id: string, visible: boolean) => void
  delete: (session_id: string) => void
}

function visibleToUser(user_id: string | undefined, owner_user_id: string | undefined) {
  if (!owner_user_id) return false
  if (!user_id) return false
  return owner_user_id === user_id
}

export function createEventVisibilityCache(limit = DEFAULT_VISIBILITY_CACHE_LIMIT): EventVisibilityCache {
  const map = new Map<string, boolean>()
  return {
    get(session_id) {
      const value = map.get(session_id)
      if (value === undefined) return
      map.delete(session_id)
      map.set(session_id, value)
      return value
    },
    set(session_id, visible) {
      if (map.has(session_id)) map.delete(session_id)
      map.set(session_id, visible)
      while (map.size > limit) {
        const oldest = map.keys().next().value
        if (!oldest) return
        map.delete(oldest)
      }
    },
    delete(session_id) {
      map.delete(session_id)
    },
  }
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

export async function warmEventVisibilityCache(input: {
  events: Event[]
  userID?: string
  cache?: EventVisibilityCache
  projectID?: string
}) {
  if (!input.userID && !input.projectID) return
  if (input.events.length === 0) return
  const ids = [...new Set(input.events.map(eventSessionID).filter((id): id is string => !!id))]
  if (ids.length === 0) return

  const cache = input.cache
  const pending = cache ? ids.filter((id) => cache.get(id) === undefined) : ids
  if (pending.length === 0) return

  const rows = await Database.use((db) =>
    db
      .select({
        id: SessionTable.id,
        user_id: SessionTable.user_id,
      })
      .from(SessionTable)
      .where(inArray(SessionTable.id, pending))
      .all(),
  )

  const ownerBySession = new Map(rows.map((item) => [item.id, item.user_id ?? undefined]))
  for (const session_id of pending) {
    input.cache?.set(session_id, visibleToUser(input.userID, ownerBySession.get(session_id)))
  }
}

export async function eventVisibleToUser(input: {
  event: Event
  userID?: string
  cache?: EventVisibilityCache
  projectID?: string
}) {
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
  const visible = visibleToUser(input.userID, row?.user_id ?? undefined)
  input.cache?.set(sessionID, visible)
  return visible
}
