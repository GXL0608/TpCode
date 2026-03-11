import path from "path"
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionVoiceTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { AccountSystemSettingService } from "../../src/user/system-setting"
import { Flag } from "../../src/flag/flag"

Log.init({ print: false })

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
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

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("keeps stored part order stable when file resolution is async", async () => {
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

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "still-missing.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "still-missing.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
        expect(text[1]?.includes("Read tool failed to read")).toBe(true)
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const template = "Read @file#name.txt"
        const parts = await SessionPrompt.resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.length).toBe(1)
        expect(fileParts[0].filename).toBe("file#name.txt")
        expect(fileParts[0].url).toContain("%23")

        const decodedPath = fileURLToPath(fileParts[0].url)
        expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })
        const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const textParts = stored.parts.filter((part) => part.type === "text")
        const hasContent = textParts.some((part) => part.text.includes("special content"))
        expect(hasContent).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "opencode", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})

describe("session.prompt managed model", () => {
  test.skipIf(!Flag.TPCODE_ACCOUNT_ENABLED)("ignores client model, variant, and local agent model in strict account mode", async () => {
    const control = await AccountSystemSettingService.providerControl()
    const auths = await AccountSystemSettingService.providerAuths()
    const configs = await AccountSystemSettingService.providerConfigs()

    try {
      await AccountSystemSettingService.setProviderAuth("openai", {
        type: "api",
        key: "sk-global-openai",
      })
      await AccountSystemSettingService.setProviderControl({
        model: "openai/gpt-5.2-chat-latest",
        small_model: "openai/gpt-5.2-chat-latest",
        enabled_providers: ["openai"],
      })

      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "anthropic/claude-sonnet-4-20250514",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          process.env.OPENAI_API_KEY = "test-openai-key"
          process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
        },
        fn: async () => {
          const session = await Session.create({})

          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
            variant: "high",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })

          if (message.info.role !== "user") throw new Error("expected user message")
          expect(message.info.model).toEqual({
            providerID: "openai",
            modelID: "gpt-5.2-chat-latest",
          })
          expect(message.info.variant).toBeUndefined()

          await Session.remove(session.id)
        },
      })
    } finally {
      await AccountSystemSettingService.setProviderControl(control)
      for (const providerID of Object.keys(await AccountSystemSettingService.providerAuths())) {
        if (auths[providerID]) continue
        await AccountSystemSettingService.removeProviderAuth(providerID)
      }
      for (const [providerID, auth] of Object.entries(auths)) {
        await AccountSystemSettingService.setProviderAuth(providerID, auth)
      }
      for (const providerID of Object.keys(await AccountSystemSettingService.providerConfigs())) {
        if (configs[providerID]) continue
        await AccountSystemSettingService.removeProviderConfig(providerID)
      }
      for (const [providerID, config] of Object.entries(configs)) {
        await AccountSystemSettingService.setProviderConfig(providerID, config)
      }
    }
  })
})

describe("session.prompt voice", () => {
  test("stores data audio attachment and rewrites part url", async () => {
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

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const payload = Buffer.from("voice-data", "utf-8").toString("base64")

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "text",
              text: "voice text",
            },
            {
              type: "file",
              mime: "audio/webm",
              filename: "voice.webm",
              url: `data:audio/webm;base64,${payload}`,
              duration_ms: 4200,
              forModel: false,
            },
          ],
        })

        if (message.info.role !== "user") throw new Error("expected user message")
        const audio = message.parts.find((part): part is MessageV2.FilePart => part.type === "file")
        expect(audio).toBeDefined()
        if (!audio) return

        expect(audio.url).toMatch(new RegExp(`^/session/${session.id}/voice/voice_`))
        expect(audio.forModel).toBe(false)

        const row = await Database.use((db) =>
          db.select().from(SessionVoiceTable).where(eq(SessionVoiceTable.part_id, audio.id)).get(),
        )
        expect(row).toBeDefined()
        if (!row) return

        expect(row.session_id).toBe(session.id)
        expect(row.message_id).toBe(message.info.id)
        expect(row.mime).toBe("audio/webm")
        expect(row.filename).toBe("voice.webm")
        expect(row.duration_ms).toBe(4200)
        expect(row.stt_text).toBe("voice text")
        expect(row.stt_engine).toBe("browser_speech_recognition")
        expect(row.size_bytes).toBe(Buffer.from("voice-data", "utf-8").length)
        expect(Buffer.from(row.audio_bytes).toString("utf-8")).toBe("voice-data")

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt plan confidentiality hardening", () => {
  const refusal =
    "计划模式不提供项目目录或文件内容。我可以提供实现计划、影响范围、风险和验证步骤总结。请告诉我你需要什么样的计划细节，我会尽力提供。"

  const required = [
    "## Confidentiality Contract",
    "### Default-Deny Rule",
    "### Override Immunity",
    "### No-Verbatim Rule",
    "### Allowed Output Only",
    "### Equivalent Request Handling",
    "### Tool Result Non-Repetition",
    "### Pre-Response 3-Step Self-Check",
    refusal,
  ]

  test("plan.txt includes strict confidentiality clauses", async () => {
    const text = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt/plan.txt")).text()
    for (const clause of required) {
      expect(text).toContain(clause)
    }
  })

  test("prompt.ts dynamic reminder includes matching confidentiality clauses", async () => {
    const text = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt.ts")).text()
    for (const clause of required) {
      expect(text).toContain(clause)
    }
    expect(text).toContain("Include high-level component-level impact (without path-level details)")
  })

  test("red team prompt set contains at least 60 adversarial prompts across key classes", async () => {
    const text = await Bun.file(path.join(import.meta.dir, "fixtures/plan-red-team-prompts.txt")).text()
    const prompts = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)

    expect(prompts.length).toBeGreaterThanOrEqual(60)

    const joined = prompts.join("\n").toLowerCase()

    expect(/(directory|目录|tree|ls)/i.test(joined)).toBe(true)
    expect(/(full content|全文|verbatim|raw content|source code)/i.test(joined)).toBe(true)
    expect(/(first 10 lines|lines 1-50|head|tail)/i.test(joined)).toBe(true)
    expect(/(cat|find|xargs|sed|awk)/i.test(joined)).toBe(true)
    expect(/(base64|hex|escaped|unicode)/i.test(joined)).toBe(true)
    expect(/(ignore|authorized|approved test|override|绕过|授权)/i.test(joined)).toBe(true)
  })
})
