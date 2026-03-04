import { describe, expect, test } from "bun:test"
import { SessionSync } from "../../src/session/sync"
import type { Session } from "../../src/session"

/**
 * Contract matrix (sync.ts -> sync-server.schemas):
 * - Session payload keys: id/projectID/workspaceID/parentID/slug/directory/title/version/summary/share/revert/permission/time
 * - Account keys (must exist): user_id/org_id/department_id/visibility
 * - Message payload keys: sessionID + message(id/role/parentID/time/... + parts)
 */

function sessionInfo(input?: Partial<Session.Info>): Session.Info {
  return {
    id: "ses_contract_001",
    slug: "contract",
    projectID: "proj_contract",
    directory: "/tmp/contract",
    title: "contract",
    version: "local",
    visibility: "private",
    time: {
      created: 1,
      updated: 1,
    },
    ...input,
  }
}

describe("session.sync contract", () => {
  test("buildSessionPayloadForAccount includes required account keys even when null", () => {
    const payload = SessionSync.buildSessionPayloadForAccount(
      sessionInfo(),
      {
        user_id: null,
        org_id: null,
        department_id: null,
        visibility: "public",
      },
      123,
    )

    expect(payload.type).toBe("session")
    expect(payload.timestamp).toBe(123)
    expect(payload.data.id).toBe("ses_contract_001")
    expect("user_id" in payload.data).toBe(true)
    expect("org_id" in payload.data).toBe(true)
    expect("department_id" in payload.data).toBe(true)
    expect("visibility" in payload.data).toBe(true)
    expect(payload.data.user_id).toBeNull()
    expect(payload.data.org_id).toBeNull()
    expect(payload.data.department_id).toBeNull()
    expect(payload.data.visibility).toBe("public")
  })

  test("buildMessagePayloadForTesting keeps sessionID/message/parts shape", () => {
    const payload = SessionSync.buildMessagePayloadForTesting(
      "ses_contract_001",
      {
        info: {
          id: "msg_contract_001",
          sessionID: "ses_should_be_ignored",
          role: "assistant",
          parentID: "msg_parent",
          time: { created: 1 },
          mode: "default",
          agent: "default",
          path: { cwd: "/tmp", root: "/tmp" },
          modelID: "test-model",
          providerID: "test-provider",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: "prt_contract_001",
            sessionID: "ses_contract_001",
            messageID: "msg_contract_001",
            type: "text",
            text: "hello",
          },
        ],
      },
      456,
    )

    expect(payload.type).toBe("message")
    expect(payload.timestamp).toBe(456)
    expect(payload.data.sessionID).toBe("ses_contract_001")
    expect(payload.data.message.id).toBe("msg_contract_001")
    expect(payload.data.message.parts).toHaveLength(1)
    expect(payload.data.message.sessionID).toBeUndefined()
  })

  test("parseRetryPayloadForTesting supports string and object payloads", () => {
    const fromString = SessionSync.parseRetryPayloadForTesting(
      JSON.stringify({ type: "session", sessionID: "ses_contract_001" }),
    )
    const fromObject = SessionSync.parseRetryPayloadForTesting({
      type: "message",
      sessionID: "ses_contract_001",
      messageID: "msg_contract_001",
    })

    expect(fromString).toStrictEqual({ type: "session", sessionID: "ses_contract_001" })
    expect(fromObject).toStrictEqual({
      type: "message",
      sessionID: "ses_contract_001",
      messageID: "msg_contract_001",
    })
  })
})
