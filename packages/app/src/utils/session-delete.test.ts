import { describe, expect, test } from "bun:test"
import { removeSessionBranch } from "./session-delete"

describe("session-delete", () => {
  test("删除根会话时会一并移除所有子会话并保留原顺序", () => {
    expect(
      removeSessionBranch(
        [
          { id: "root_keep" },
          { id: "root_delete" },
          { id: "child_delete_1", parentID: "root_delete" },
          { id: "child_delete_2", parentID: "child_delete_1" },
          { id: "root_keep_2" },
        ],
        "root_delete",
      ),
    ).toEqual([{ id: "root_keep" }, { id: "root_keep_2" }])
  })

  test("删除不存在的会话时返回原列表", () => {
    const sessions = [{ id: "root_keep" }, { id: "child_keep", parentID: "root_keep" }]
    expect(removeSessionBranch(sessions, "missing")).toEqual(sessions)
  })
})
