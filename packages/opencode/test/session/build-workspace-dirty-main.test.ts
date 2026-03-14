import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"
import { Provider } from "../../src/provider/provider"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：构造最小流式响应，专用于验证 build 首条消息在脏主分支下也能顺利进入工作区。 */
function mockLLMStream(text = "ok") {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "text-start" }
      yield { type: "text-delta", text }
      yield { type: "text-end" }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      }
      yield { type: "finish" }
    })(),
    text: Promise.resolve(text),
    totalUsage: Promise.resolve(undefined),
    providerMetadata: Promise.resolve(undefined),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

describe("session build workspace on dirty main worktree", () => {
  test("keeps the first build prompt working when the main worktree has uncommitted changes", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Bun.write(path.join(tmp.path, "dirty.txt"), "dirty\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "dirty-main-build" })
        const model = {
          id: "gpt-5.2",
          providerID: "openai",
          api: { id: "gpt-5.2" },
          options: {},
        } as unknown as Provider.Model
        const runtime = spyOn(Session, "runtimeModel").mockResolvedValue({
          providerID: model.providerID,
          modelID: model.id,
        })
        const provider = spyOn(Provider, "getModel").mockResolvedValue(model)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => mockLLMStream())

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello from dirty main" }],
          })

          const current = await Session.get(session.id)
          expect(current.directory).not.toBe(tmp.path)
          expect(current.workspaceDirectory).toBe(current.directory)
          expect(await Filesystem.isDir(current.directory)).toBe(true)
        } finally {
          stream.mockRestore()
          provider.mockRestore()
          runtime.mockRestore()
        }
      },
    })
  })
})
