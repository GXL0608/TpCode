import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { applySessionSlice, readSessionSlice, removeSessionSlice } from "./sync"
import type { State } from "./global-sync/types"

/** 中文注释：构造最小 child store，便于验证会话在不同目录 store 之间迁移。 */
function state(): State {
  return {
    status: "complete",
    agent: [],
    command: [],
    project: "project",
    projectMeta: undefined,
    icon: undefined,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "/repo/main", directory: "/repo/main", home: "" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
  }
}

/** 中文注释：构造一个根会话，模拟 plan 模式已存在历史消息的场景。 */
function session(id: string): Session {
  return {
    id,
    title: "session",
    directory: "/repo/main",
    time: { created: 1 },
  } as Session
}

/** 中文注释：构造测试消息，验证迁移后历史消息顺序和归属保持不变。 */
function message(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "plan",
    model: { providerID: "openai", modelID: "gpt" },
  }
}

/** 中文注释：构造测试消息分片，验证消息内容跟随会话一并迁移。 */
function part(id: string, sessionID: string, messageID: string): Part {
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }
}

describe("sync session migration", () => {
  test("moves an existing session slice into the prepared workspace store", () => {
    const sessionID = "ses_1"
    const source = state()
    const target = state()
    const sourceSession = session(sessionID)
    const sourceMessages = [message("msg_1", sessionID), message("msg_2", sessionID)]

    source.session = [sourceSession]
    source.sessionTotal = 1
    source.session_status[sessionID] = { type: "busy" }
    source.session_diff[sessionID] = [
      { file: "src/app.ts", before: "", after: "", additions: 1, deletions: 0, status: "modified" },
    ]
    source.todo[sessionID] = [{ content: "todo", status: "pending", priority: "high" }]
    source.permission[sessionID] = [
      {
        id: "perm_1",
        sessionID,
        permission: "command",
        patterns: ["*"],
        metadata: {},
        always: [],
      } as PermissionRequest,
    ]
    source.question[sessionID] = [
      {
        id: "q_1",
        sessionID,
        questions: [
          {
            question: "继续吗？",
            header: "继续吗？",
            options: [{ label: "是", description: "继续" }],
          },
        ],
      } as QuestionRequest,
    ]
    source.message[sessionID] = sourceMessages
    source.part.msg_1 = [part("prt_1", sessionID, "msg_1")]
    source.part.msg_2 = [part("prt_2", sessionID, "msg_2")]

    const slice = readSessionSlice(source, sessionID)
    applySessionSlice(target, slice, sessionID)
    removeSessionSlice(source, slice, sessionID)

    expect(target.session.map((item) => item.id)).toEqual([sessionID])
    expect(target.sessionTotal).toBe(1)
    expect(target.session_status[sessionID]?.type).toBe("busy")
    expect(target.session_diff[sessionID]?.[0]?.file).toBe("src/app.ts")
    expect(target.todo[sessionID]?.[0]?.content).toBe("todo")
    expect(target.permission[sessionID]?.[0]?.id).toBe("perm_1")
    expect(target.question[sessionID]?.[0]?.id).toBe("q_1")
    expect(target.message[sessionID]?.map((item) => item.id)).toEqual(["msg_1", "msg_2"])
    expect(target.part.msg_1?.map((item) => item.id)).toEqual(["prt_1"])
    expect(target.part.msg_2?.map((item) => item.id)).toEqual(["prt_2"])

    expect(source.session).toEqual([])
    expect(source.sessionTotal).toBe(0)
    expect(source.session_status[sessionID]).toBeUndefined()
    expect(source.session_diff[sessionID]).toBeUndefined()
    expect(source.todo[sessionID]).toBeUndefined()
    expect(source.permission[sessionID]).toBeUndefined()
    expect(source.question[sessionID]).toBeUndefined()
    expect(source.message[sessionID]).toBeUndefined()
    expect(source.part.msg_1).toBeUndefined()
    expect(source.part.msg_2).toBeUndefined()
  })
})
