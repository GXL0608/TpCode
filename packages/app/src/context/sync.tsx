import { batch, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { archiveCleanupFailed, archiveWithConfirm } from "@/utils/session-archive"
import { useLanguage } from "./language"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { resolveProjectByDirectory } from "./project-resolver"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    map.delete(key)
  })
  map.set(key, promise)
  return promise
}

const keyFor = (directory: string, id: string) => `${directory}\n${id}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

type FetchInput = {
  sessionID: string
  stale: boolean
  session: Message[]
  part: { id: string; part: Part[] }[]
  removed?: {
    message?: Set<string>
    part?: Map<string, Set<string>>
  }
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (!messages) {
    draft.message[input.sessionID] = [input.message]
  }
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

export function applyFetchedMessages(draft: OptimisticStore, input: FetchInput) {
  if (!input.stale) {
    draft.message[input.sessionID] = input.session.slice()
    for (const item of input.part) {
      draft.part[item.id] = sortParts(item.part)
    }
    return
  }

  const removedMessage = input.removed?.message
  const removedPart = input.removed?.part
  const current = draft.message[input.sessionID] ?? []
  const next = current.slice()
  let changed = draft.message[input.sessionID] === undefined

  for (const message of input.session) {
    if (removedMessage?.has(message.id)) continue
    const result = Binary.search(next, message.id, (item) => item.id)
    if (result.found) continue
    next.splice(result.index, 0, message)
    changed = true
  }

  if (changed) {
    draft.message[input.sessionID] = next
  }

  for (const item of input.part) {
    if (removedMessage?.has(item.id)) continue
    const incoming = sortParts(item.part).filter((part) => !removedPart?.get(item.id)?.has(part.id))
    if (incoming.length === 0) continue
    const existing = draft.part[item.id]
    if (!existing) {
      draft.part[item.id] = incoming
      continue
    }
    const merged = existing.slice()
    let added = false
    for (const part of incoming) {
      const result = Binary.search(merged, part.id, (value) => value.id)
      if (result.found) continue
      merged.splice(result.index, 0, part)
      added = true
    }
    if (added) {
      draft.part[item.id] = merged
    }
  }
}

export function isFetchedSnapshotStale(input: {
  sessionID: string
  current: OptimisticStore
  next: { session: Message[]; part: { id: string; part: Part[] }[] }
  removed?: FetchInput["removed"]
}) {
  const messages = input.current.message[input.sessionID] ?? []
  const fetched = new Set(input.next.session.map((item) => item.id))
  if (messages.some((item) => !fetched.has(item.id))) return true

  const removedMessage = input.removed?.message
  if (removedMessage && input.next.session.some((item) => removedMessage.has(item.id))) return true

  const parts = new Map(input.next.part.map((item) => [item.id, new Set(item.part.map((part) => part.id))]))
  for (const message of messages) {
    const current = input.current.part[message.id] ?? []
    const fetched = parts.get(message.id) ?? new Set<string>()
    if (current.some((part) => !fetched.has(part.id))) return true
  }

  const removedPart = input.removed?.part
  if (!removedPart) return false
  for (const [messageID, ids] of removedPart.entries()) {
    const fetched = parts.get(messageID)
    if (!fetched) continue
    if ([...ids].some((partID) => fetched.has(partID))) return true
  }
  return false
}

function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return [input.message]
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    const next = [...messages]
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

function setOptimisticRemove(setStore: (...args: unknown[]) => void, input: OptimisticRemoveInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return messages
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (!result.found) return messages
    const next = [...messages]
    next.splice(result.index, 1)
    return next
  })
  setStore("part", (part: Record<string, Part[] | undefined>) => {
    if (!(input.messageID in part)) return part
    const next = { ...part }
    delete next[input.messageID]
    return next
  })
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const globalSDK = useGlobalSDK()
    const sdk = useSDK()
    const language = useLanguage()

    type Child = ReturnType<(typeof globalSync)["child"]>
    type Setter = Child[1]

    const current = createMemo(() => globalSync.child(sdk.directory))
    const target = (directory?: string) => {
      if (!directory || directory === sdk.directory) return current()
      return globalSync.child(directory)
    }
    const absolute = (path: string) => (current()[0].path.directory + "/" + path).replace("//", "/")
    const messagePageSize = 400
    const inflight = new Map<string, Promise<void>>()
    const inflightDiff = new Map<string, Promise<void>>()
    const inflightTodo = new Map<string, Promise<void>>()
    const tracked = new Set<string>()
    const version = new Map<string, number>()
    const removedMessage = new Map<string, Set<string>>()
    const removedPart = new Map<string, Map<string, Set<string>>>()
    const [meta, setMeta] = createStore({
      limit: {} as Record<string, number>,
      complete: {} as Record<string, boolean>,
      loading: {} as Record<string, boolean>,
    })

    const track = (directory: string, sessionID: string) => {
      tracked.add(keyFor(directory, sessionID))
    }

    const clear = (key: string) => {
      version.delete(key)
      removedMessage.delete(key)
      removedPart.delete(key)
    }

    const touch = (directory: string, sessionID: string) => {
      const key = keyFor(directory, sessionID)
      if (!tracked.has(key)) return
      version.set(key, (version.get(key) ?? 0) + 1)
    }

    const markRemovedMessage = (directory: string, sessionID: string, messageID: string) => {
      const key = keyFor(directory, sessionID)
      if (!tracked.has(key)) return
      const existing = removedMessage.get(key)
      if (existing) {
        existing.add(messageID)
      }
      if (!existing) {
        removedMessage.set(key, new Set([messageID]))
      }
      removedPart.get(key)?.delete(messageID)
      touch(directory, sessionID)
    }

    const markRemovedPart = (directory: string, sessionID: string, messageID: string, partID: string) => {
      const key = keyFor(directory, sessionID)
      if (!tracked.has(key)) return
      const messages = removedPart.get(key) ?? new Map<string, Set<string>>()
      const parts = messages.get(messageID) ?? new Set<string>()
      parts.add(partID)
      messages.set(messageID, parts)
      removedPart.set(key, messages)
      touch(directory, sessionID)
    }

    const stop = globalSDK.event.listen((event) => {
      if (event.name !== sdk.directory) return
      if (event.details.type === "message.updated") {
        const sessionID = event.details.properties.info?.sessionID
        if (!sessionID) return
        touch(event.name, sessionID)
        return
      }
      if (event.details.type === "message.removed") {
        const sessionID = event.details.properties.sessionID
        const messageID = event.details.properties.messageID
        if (!sessionID || !messageID) return
        markRemovedMessage(event.name, sessionID, messageID)
        return
      }
      if (event.details.type === "message.part.updated" || event.details.type === "message.part.delta") {
        const sessionID =
          event.details.type === "message.part.updated"
            ? event.details.properties.part?.sessionID
            : event.details.properties.sessionID
        if (!sessionID) return
        touch(event.name, sessionID)
        return
      }
      if (event.details.type === "message.part.removed") {
        const sessionID = event.details.properties.sessionID
        const messageID = event.details.properties.messageID
        const partID = event.details.properties.partID
        if (!sessionID || !messageID || !partID) return
        markRemovedPart(event.name, sessionID, messageID, partID)
      }
    })

    onCleanup(stop)
    onCleanup(() => {
      tracked.clear()
      version.clear()
      removedMessage.clear()
      removedPart.clear()
    })

    const getSession = (sessionID: string) => {
      const store = current()[0]
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    const limitFor = (count: number) => {
      if (count <= messagePageSize) return messagePageSize
      return Math.ceil(count / messagePageSize) * messagePageSize
    }

    const fetchMessages = async (input: { client: typeof sdk.client; sessionID: string; limit: number }) => {
      const messages = await input.client.session.messages({ sessionID: input.sessionID, limit: input.limit })
      const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
      const session = items
        .map((x) => x.info)
        .filter((m) => !!m?.id)
        .sort((a, b) => cmp(a.id, b.id))
      const part = items.map((message) => ({ id: message.info.id, part: sortParts(message.parts) }))
      return {
        session,
        part,
        complete: session.length < input.limit,
      }
    }

    const loadMessages = async (input: {
      directory: string
      client: typeof sdk.client
      setStore: Setter
      sessionID: string
      limit: number
    }) => {
      const key = keyFor(input.directory, input.sessionID)
      if (meta.loading[key]) return

      track(input.directory, input.sessionID)
      const start = version.get(key) ?? 0
      setMeta("loading", key, true)
      await fetchMessages(input)
        .then((next) => {
          const removed = {
            message: removedMessage.get(key),
            part: removedPart.get(key),
          }
          const stale =
            (version.get(key) ?? 0) !== start ||
            isFetchedSnapshotStale({
              sessionID: input.sessionID,
              current: current()[0],
              next,
              removed,
            })
          batch(() => {
            input.setStore(
              produce((draft) => {
                applyFetchedMessages(draft, {
                  sessionID: input.sessionID,
                  stale,
                  session: next.session,
                  part: next.part,
                  removed: stale ? removed : undefined,
                })
              }),
            )
            setMeta("limit", key, input.limit)
            setMeta("complete", key, next.complete)
          })
          clear(key)
        })
        .finally(() => {
          setMeta("loading", key, false)
        })
    }

    return {
      get data() {
        return current()[0]
      },
      get set(): Setter {
        return current()[1]
      },
      get status() {
        return current()[0].status
      },
      get ready() {
        return current()[0].status !== "loading"
      },
      get project() {
        return resolveProjectByDirectory(globalSync.data.project, sdk.directory)
      },
      session: {
        get: getSession,
        optimistic: {
          add(input: { directory?: string; sessionID: string; message: Message; parts: Part[] }) {
            const directory = input.directory ?? sdk.directory
            track(directory, input.sessionID)
            const [, setStore] = target(input.directory)
            setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
            touch(directory, input.sessionID)
          },
          remove(input: { directory?: string; sessionID: string; messageID: string }) {
            const directory = input.directory ?? sdk.directory
            track(directory, input.sessionID)
            const [, setStore] = target(input.directory)
            setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
            markRemovedMessage(directory, input.sessionID, input.messageID)
          },
        },
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          track(sdk.directory, input.sessionID)
          const [, setStore] = target()
          setOptimisticAdd(setStore as (...args: unknown[]) => void, {
            sessionID: input.sessionID,
            message,
            parts: input.parts,
          })
          touch(sdk.directory, input.sessionID)
        },
        async sync(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          const key = keyFor(directory, sessionID)
          const hasSession = (() => {
            const match = Binary.search(store.session, sessionID, (s) => s.id)
            return match.found
          })()

          const hasMessages = store.message[sessionID] !== undefined
          const hydrated = meta.limit[key] !== undefined
          if (hasSession && hasMessages && hydrated) return

          const count = store.message[sessionID]?.length ?? 0
          const limit = hydrated ? (meta.limit[key] ?? messagePageSize) : limitFor(count)

          const sessionReq = hasSession
            ? Promise.resolve()
            : client.session.get({ sessionID }).then((session) => {
                const data = session.data
                if (!data) return
                setStore(
                  "session",
                  produce((draft) => {
                    const match = Binary.search(draft, sessionID, (s) => s.id)
                    if (match.found) {
                      draft[match.index] = data
                      return
                    }
                    draft.splice(match.index, 0, data)
                  }),
                )
              })

          const messagesReq =
            hasMessages && hydrated
              ? Promise.resolve()
              : loadMessages({
                  directory,
                  client,
                  setStore,
                  sessionID,
                  limit,
                })

          return runInflight(inflight, key, () => Promise.all([sessionReq, messagesReq]).then(() => {}))
        },
        async diff(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          if (store.session_diff[sessionID] !== undefined) return

          const key = keyFor(directory, sessionID)
          return runInflight(inflightDiff, key, () =>
            client.session.diff({ sessionID }).then((diff) => {
              setStore("session_diff", sessionID, reconcile(diff.data ?? [], { key: "file" }))
            }),
          )
        },
        async todo(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          const existing = store.todo[sessionID]
          if (existing !== undefined) {
            if (globalSync.data.session_todo[sessionID] === undefined) {
              globalSync.todo.set(sessionID, existing)
            }
            return
          }

          const cached = globalSync.data.session_todo[sessionID]
          if (cached !== undefined) {
            setStore("todo", sessionID, reconcile(cached, { key: "id" }))
          }

          const key = keyFor(directory, sessionID)
          return runInflight(inflightTodo, key, () =>
            client.session.todo({ sessionID }).then((todo) => {
              const list = todo.data ?? []
              setStore("todo", sessionID, reconcile(list, { key: "id" }))
              globalSync.todo.set(sessionID, list)
            }),
          )
        },
        history: {
          more(sessionID: string) {
            const store = current()[0]
            const key = keyFor(sdk.directory, sessionID)
            if (store.message[sessionID] === undefined) return false
            if (meta.limit[key] === undefined) return false
            if (meta.complete[key]) return false
            return true
          },
          loading(sessionID: string) {
            const key = keyFor(sdk.directory, sessionID)
            return meta.loading[key] ?? false
          },
          async loadMore(sessionID: string, count = messagePageSize) {
            const directory = sdk.directory
            const client = sdk.client
            const [, setStore] = globalSync.child(directory)
            const key = keyFor(directory, sessionID)
            if (meta.loading[key]) return
            if (meta.complete[key]) return

            const currentLimit = meta.limit[key] ?? messagePageSize
            await loadMessages({
              directory,
              client,
              setStore,
              sessionID,
              limit: currentLimit + count,
            })
          },
        },
        fetch: async (count = 10) => {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          setStore("limit", (x) => x + count)
          await client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .sort((a, b) => cmp(a.id, b.id))
              .slice(0, store.limit)
            setStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => current()[0].session.length >= current()[0].limit),
        archive: async (sessionID: string) => {
          const directory = sdk.directory
          const client = sdk.client
          const [, setStore] = globalSync.child(directory)
          const ok = await archiveWithConfirm({
            t: language.t,
            preview: () =>
              client.session
                .archivePreview({ sessionID })
                .then((x) => x.data)
                .catch(() => undefined),
            archive: (force) =>
              client.session.archive({ sessionID, time: Date.now(), force }).then((x) => {
                if (archiveCleanupFailed(x.data)) throw new Error(language.t("session.archive.cleanup.failed"))
              }),
            confirm: (message) => globalThis.confirm?.(message) ?? true,
          })
          if (!ok) return
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return current()[0].path.directory
      },
    }
  },
})
