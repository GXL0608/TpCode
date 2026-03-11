import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { applyFetchedMessages } from "./sync"

const userMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const assistantMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "assistant",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
} as unknown as Message)

const textPart = (id: string, sessionID: string, messageID: string, text = id): Part => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text,
})

describe("sync hydration", () => {
  test("stale fetch keeps newer messages and backfills older history", () => {
    const sessionID = "ses_1"
    const draft = {
      message: {
        [sessionID]: [userMessage("msg_2", sessionID), assistantMessage("msg_3", sessionID)],
      },
      part: {
        msg_2: [textPart("prt_2", sessionID, "msg_2", "fresh-user")],
        msg_3: [textPart("prt_3", sessionID, "msg_3", "fresh")],
      } as Record<string, Part[] | undefined>,
    }

    applyFetchedMessages(draft, {
      sessionID,
      stale: true,
      session: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)],
      part: [
        { id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] },
        { id: "msg_2", part: [textPart("prt_2", sessionID, "msg_2", "old")] },
      ],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2", "msg_3"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1"])
    expect((draft.part.msg_2?.[0] as Extract<Part, { type: "text" }>)?.text).toBe("fresh-user")
    expect((draft.part.msg_3?.[0] as Extract<Part, { type: "text" }>)?.text).toBe("fresh")
  })

  test("stale fetch does not revive removed messages or parts", () => {
    const sessionID = "ses_1"
    const draft = {
      message: {
        [sessionID]: [userMessage("msg_2", sessionID)],
      },
      part: {
        msg_2: [textPart("prt_2", sessionID, "msg_2", "fresh")],
      } as Record<string, Part[] | undefined>,
    }

    applyFetchedMessages(draft, {
      sessionID,
      stale: true,
      removed: {
        message: new Set(["msg_1"]),
        part: new Map([["msg_2", new Set(["prt_1"])]]),
      },
      session: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)],
      part: [
        { id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] },
        {
          id: "msg_2",
          part: [textPart("prt_1", sessionID, "msg_2", "stale"), textPart("prt_2", sessionID, "msg_2", "stale")],
        },
      ],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_2"])
    expect(draft.part.msg_2?.map((x) => x.id)).toEqual(["prt_2"])
    expect((draft.part.msg_2?.[0] as Extract<Part, { type: "text" }>)?.text).toBe("fresh")
  })

  test("fresh fetch replaces hydrated messages", () => {
    const sessionID = "ses_1"
    const draft = {
      message: {
        [sessionID]: [userMessage("msg_9", sessionID)],
      },
      part: {
        msg_9: [textPart("prt_9", sessionID, "msg_9")],
      } as Record<string, Part[] | undefined>,
    }

    applyFetchedMessages(draft, {
      sessionID,
      stale: false,
      session: [userMessage("msg_1", sessionID), assistantMessage("msg_2", sessionID)],
      part: [
        { id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] },
        { id: "msg_2", part: [textPart("prt_2", sessionID, "msg_2", "reply")] },
      ],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1"])
    expect((draft.part.msg_2?.[0] as Extract<Part, { type: "text" }>)?.text).toBe("reply")
  })
})
