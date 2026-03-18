import { describe, expect, test } from "bun:test"
import {
  SESSION_BUILD_STATUS_CARD_CLASS,
  SESSION_BUILD_STATUS_LAYOUT_CLASS,
  SESSION_BUILD_STATUS_SCROLL_CLASS,
} from "./session-build-status"

describe("session-build-status layout", () => {
  test("构建状态卡片限制整体尺寸，避免长日志把会话区整体撑宽撑高", () => {
    expect(SESSION_BUILD_STATUS_CARD_CLASS).toContain("min-w-0")
    expect(SESSION_BUILD_STATUS_CARD_CLASS).toContain("overflow-hidden")
    expect(SESSION_BUILD_STATUS_LAYOUT_CLASS).toContain("max-h-[min(42vh,420px)]")
    expect(SESSION_BUILD_STATUS_LAYOUT_CLASS).toContain("overflow-hidden")
    expect(SESSION_BUILD_STATUS_SCROLL_CLASS).toContain("overflow-y-auto")
    expect(SESSION_BUILD_STATUS_SCROLL_CLASS).toContain("overflow-x-hidden")
  })
})
