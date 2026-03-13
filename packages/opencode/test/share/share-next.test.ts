import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { Provider } from "../../src/provider/provider"

const projectRoot = path.join(__dirname, "../..")

describe("share-next", () => {
  test("does not block message.updated publish on model lookup", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const sleep = (ms: number) => new Promise((resolve) => originalSetTimeout(resolve, ms))

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        globalThis.setTimeout = (() => 0) as unknown as typeof globalThis.setTimeout

        const gate = Promise.withResolvers<Provider.Model>()
        const getModel = spyOn(Provider, "getModel").mockImplementation(() => gate.promise)
        try {
          const { ShareNext } = await import("../../src/share/share-next")
          await ShareNext.init()

          const publish = Bus.publish(MessageV2.Event.Updated, {
            info: {
              id: "message_1",
              sessionID: "session_1",
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: {
                providerID: "openai",
                modelID: "gpt-5",
              },
            } as MessageV2.User,
          })

          const result = await Promise.race([
            publish.then(() => "resolved"),
            sleep(25).then(() => "timeout"),
          ])

          gate.resolve({
            id: "gpt-5",
            providerID: "openai",
            api: {
              id: "gpt-5",
              url: "https://example.com",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5",
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
              output: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
              interleaved: false,
            },
            cost: {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
            limit: {
              context: 0,
              input: 0,
              output: 0,
            },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
          })
          await publish

          expect(result).toBe("resolved")
        } finally {
          getModel.mockRestore()
          globalThis.setTimeout = originalSetTimeout
        }
      },
    })
  })
})
