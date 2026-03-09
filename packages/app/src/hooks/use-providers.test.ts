import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

let useProviders: typeof import("./use-providers").useProviders
let directory = ""
let loadCalls: Array<string | undefined> = []
let childCalls: Array<{ directory: string; bootstrap: boolean | undefined }> = []

const globalProvider = {
  all: [{ id: "global", name: "Global", env: [], npm: "", models: {} }],
  connected: [],
  default: {},
}

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useParams: () => ({ dir: directory }),
  }))
  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      loadProvider: (value?: string) => {
        loadCalls.push(value)
        return Promise.resolve()
      },
      child: (value: string, options?: { bootstrap?: boolean }) => {
        childCalls.push({ directory: value, bootstrap: options?.bootstrap })
        return [
          { provider: { all: [], connected: [], default: {} } },
          () => undefined,
        ]
      },
      data: {
        provider: globalProvider,
      },
    }),
  }))
  useProviders = (await import("./use-providers")).useProviders
})

describe("useProviders", () => {
  test("uses current directory store without triggering directory bootstrap", () => {
    directory = Buffer.from("/repo").toString("base64")
    loadCalls = []
    childCalls = []

    createRoot((dispose) => {
      const providers = useProviders()
      expect(providers.all()).toEqual(globalProvider.all)
      expect(childCalls).toEqual([{ directory: "/repo", bootstrap: false }])
      dispose()
    })
  })

  test("loads global providers when no directory is selected", async () => {
    directory = ""
    loadCalls = []
    childCalls = []

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const providers = useProviders()
        expect(providers.all()).toEqual(globalProvider.all)
        setTimeout(() => {
          expect(loadCalls).toEqual([undefined])
          expect(childCalls).toEqual([])
          dispose()
          resolve()
        }, 0)
      })
    })
  })
})
