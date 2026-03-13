import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager

beforeAll(async () => {
  mock.module("@/utils/persist", () => ({
    Persist: {
      workspace: () => "workspace",
    },
    persisted: (_key: unknown, value: unknown) => {
      const tuple = value as ReturnType<typeof import("solid-js/store").createStore>
      return [...tuple, undefined, () => true] as const
    },
  }))

  const mod = await import("./child-store")
  createChildStoreManager = mod.createChildStoreManager
})

describe("createChildStoreManager", () => {
  test("force dispose removes a deleted workspace even while bootstrap is in progress", () => {
    const disposed: string[] = []

    createRoot((dispose) => {
      const owner = getOwner()
      if (!owner) throw new Error("missing owner")

      const store = createChildStoreManager({
        owner,
        isBooting: (directory) => directory === "/repo/worktree",
        isLoadingSessions: () => false,
        onBootstrap: () => {},
        onDispose: (directory) => {
          disposed.push(directory)
        },
      })

      store.child("/repo/worktree", { bootstrap: false })

      expect(store.disposeDirectory("/repo/worktree")).toBe(false)
      expect(store.disposeDirectory("/repo/worktree", { force: true })).toBe(true)
      expect(disposed).toEqual(["/repo/worktree"])

      dispose()
    })
  })
})
