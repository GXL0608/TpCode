import { describe, expect, test } from "bun:test"
import { submitPlanSave } from "./plan-save"

describe("submitPlanSave", () => {
  test("直接保存计划并在成功后触发后置回调", async () => {
    const calls: {
      save: Array<{
        sessionID: string
        messageID: string
        partID: string
      }>
      saving: boolean[]
      saved: number
      after: string[]
    } = {
      save: [],
      saving: [],
      saved: 0,
      after: [],
    }

    const result = await submitPlanSave({
      saving: false,
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      savePlan: async (input) => {
        calls.save.push(input)
        return {
          ok: true,
          id: "plan-1",
          saved_at: 1,
          session_id: "session-1",
          message_id: "message-1",
          part_id: "part-1",
        }
      },
      afterSavePlan: async (input) => {
        calls.after.push(input.id)
      },
      onSaving: (value) => {
        calls.saving.push(value)
      },
      onSaved: () => {
        calls.saved += 1
      },
    })

    expect(result).toEqual({
      ok: true,
      id: "plan-1",
      saved_at: 1,
      session_id: "session-1",
      message_id: "message-1",
      part_id: "part-1",
    })
    expect(calls.save).toEqual([
      {
        sessionID: "session-1",
        messageID: "message-1",
        partID: "part-1",
      },
    ])
    expect("vho_feedback_no" in calls.save[0]!).toBe(false)
    expect(calls.saving).toEqual([true, false])
    expect(calls.saved).toBe(1)
    expect(calls.after).toEqual(["plan-1"])
  })

  test("保存进行中时不重复提交", async () => {
    const result = await submitPlanSave({
      saving: true,
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      savePlan: async () => {
        throw new Error("should not run")
      },
      onSaving: () => undefined,
      onSaved: () => undefined,
    })

    expect(result).toBeFalse()
  })
})
