import { describe, expect, test } from "bun:test"
import {
  buildLiveHeadline,
  buildRefreshText,
  SESSION_BUILD_STATUS_META_CLASS,
} from "./session-build-status"

describe("session-build-status detail helpers", () => {
  test("优先展示当前状态，其次展示步骤和最近活动，避免用户不知道后台在干什么", () => {
    expect(
      buildLiveHeadline({
        detail_json: {
          current_status: "正在准备独立编译沙盒",
          current_step: "prepare_compile_sandbox",
        },
      }),
    ).toBe("正在准备独立编译沙盒")

    expect(
      buildLiveHeadline({
        detail_json: {
          current_step: "run_compile_command",
        },
      }),
    ).toBe("当前步骤：run_compile_command")

    expect(
      buildLiveHeadline({
        detail_json: {
          recent_activity: [{ summary: "工具 bash 完成；回复：已定位登录页" }],
        },
      }),
    ).toBe("工具 bash 完成；回复：已定位登录页")
  })

  test("展示最近刷新时间，避免用户误以为界面已经卡死", () => {
    expect(buildRefreshText(undefined, 100_000)).toBe("等待状态刷新")
    expect(buildRefreshText(98_000, 100_000)).toBe("刚刚刷新")
    expect(buildRefreshText(70_000, 100_000)).toBe("30 秒前刷新")
    expect(buildRefreshText(10_000, 130_000)).toBe("2 分钟前刷新")
  })

  test("顶部摘要区保留四列元信息布局，给过程状态留出固定展示位置", () => {
    expect(SESSION_BUILD_STATUS_META_CLASS).toContain("md:grid-cols-4")
  })
})
