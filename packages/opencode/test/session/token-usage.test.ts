import { describe, expect, test } from "bun:test"
import path from "path"
import { Identifier } from "../../src/id/id"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { and, Database, eq } from "../../src/storage/db"
import { TpTokenUsageTable } from "../../src/usage/token-usage.sql"
import { TokenUsageService } from "../../src/usage/service"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("token usage", () => {
  test("records step-finish usage and keeps idempotency by scene+source", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "token-usage-step-finish" })
        const userMessage: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: {
            providerID: "openai",
            modelID: "gpt-4.1",
          },
        }
        await Session.updateMessage(userMessage)
        const assistantMessage: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          parentID: userMessage.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: {
            cwd: session.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "gpt-4.1",
          providerID: "openai",
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistantMessage)

        const stepPartID = Identifier.ascending("part")
        await Session.updatePart({
          id: stepPartID,
          sessionID: session.id,
          messageID: assistantMessage.id,
          type: "step-finish",
          reason: "stop",
          cost: 0.123456,
          tokens: {
            input: 12,
            output: 3,
            reasoning: 1,
            cache: { read: 2, write: 1 },
            total: 19,
          },
        })

        await Session.updatePart({
          id: stepPartID,
          sessionID: session.id,
          messageID: assistantMessage.id,
          type: "step-finish",
          reason: "stop",
          cost: 0.200001,
          tokens: {
            input: 20,
            output: 5,
            reasoning: 2,
            cache: { read: 3, write: 1 },
            total: 31,
          },
        })

        const rows = await Database.use((db) =>
          db
            .select()
            .from(TpTokenUsageTable)
            .where(
              and(
                eq(TpTokenUsageTable.usage_scene, "step_finish"),
                eq(TpTokenUsageTable.source_id, stepPartID),
                eq(TpTokenUsageTable.session_id, session.id),
              ),
            )
            .all(),
        )

        expect(rows.length).toBe(1)
        expect(rows[0]?.message_id).toBe(assistantMessage.id)
        expect(rows[0]?.project_id).toBe(session.projectID)
        expect(rows[0]?.workplace).toBe(session.directory)
        expect(rows[0]?.provider_id).toBe("openai")
        expect(rows[0]?.model_id).toBe("gpt-4.1")
        expect(rows[0]?.token_input).toBe(20)
        expect(rows[0]?.token_output).toBe(5)
        expect(rows[0]?.token_reasoning).toBe(2)
        expect(rows[0]?.token_cache_read).toBe(3)
        expect(rows[0]?.token_cache_write).toBe(1)
        expect(rows[0]?.token_total).toBe(31)
        expect(rows[0]?.cost_micros).toBe(200001)
      },
    })
  })

  test("records auto_title usage with deterministic source id", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "token-usage-auto-title" })
        const sourceID = `title-source-${Identifier.ascending("part")}`
        const messageID = Identifier.ascending("message")

        await TokenUsageService.recordAutoTitle({
          sessionID: session.id,
          messageID,
          providerID: "openai",
          modelID: "gpt-4.1-mini",
          cost: 0.000123,
          sourceID,
          tokens: {
            input: 33,
            output: 4,
            reasoning: 0,
            cache: { read: 0, write: 0 },
            total: 37,
          },
        })
        await TokenUsageService.recordAutoTitle({
          sessionID: session.id,
          messageID,
          providerID: "openai",
          modelID: "gpt-4.1-mini",
          cost: 0.0003,
          sourceID,
          tokens: {
            input: 34,
            output: 6,
            reasoning: 0,
            cache: { read: 0, write: 0 },
            total: 40,
          },
        })

        const rows = await Database.use((db) =>
          db
            .select()
            .from(TpTokenUsageTable)
            .where(
              and(
                eq(TpTokenUsageTable.usage_scene, "auto_title"),
                eq(TpTokenUsageTable.source_id, sourceID),
                eq(TpTokenUsageTable.session_id, session.id),
              ),
            )
            .all(),
        )

        expect(rows.length).toBe(1)
        expect(rows[0]?.message_id).toBe(messageID)
        expect(rows[0]?.token_input).toBe(34)
        expect(rows[0]?.token_output).toBe(6)
        expect(rows[0]?.token_total).toBe(40)
        expect(rows[0]?.cost_micros).toBe(300)
      },
    })
  })
})
