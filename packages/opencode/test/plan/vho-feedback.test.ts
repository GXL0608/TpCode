import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { desc, eq, Database } from "../../src/storage/db"
import { TpSavedPlanTable } from "../../src/plan/saved-plan.sql"

const { VhoFeedbackService } = await import("../../src/plan/vho-feedback")

/**
 * 中文注释：生成测试用唯一主键，避免不同用例相互污染。
 */
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 中文注释：插入一条最小化的 tp_saved_plan 测试记录。
 */
async function seedSavedPlan(input: {
  id?: string
  vho_feedback_no?: string
  plan_content: string
  time_created: number
}) {
  const id = input.id ?? uid("plan")
  await Database.use((db) =>
    db
      .insert(TpSavedPlanTable)
      .values({
        id,
        session_id: uid("session"),
        message_id: uid("message"),
        part_id: uid("part"),
        project_id: uid("project"),
        project_name: "测试项目",
        project_worktree: process.cwd(),
        session_title: "测试会话",
        user_id: uid("user"),
        username: uid("username"),
        display_name: "测试用户",
        account_type: "internal",
        org_id: uid("org"),
        department_id: "",
        agent: "plan",
        provider_id: "openai",
        model_id: "gpt-4.1-mini",
        message_created_at: input.time_created,
        plan_content: input.plan_content,
        vho_feedback_no: input.vho_feedback_no,
        time_created: input.time_created,
        time_updated: input.time_created,
      })
      .run(),
  )
  return id
}

afterEach(async () => {
  await Database.use((db) => db.delete(TpSavedPlanTable).run())
})

describe("vho feedback service", () => {
  test("maps search filters to VHO request body and normalizes paged result", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: "查询成功",
          content: {
            loginInfo: {
              userId: "13800138000",
              userName: "系统管理员",
            },
            feedbackData: {
              list: [
                {
                  feedbackId: "F20231024001",
                  planId: "plan_123",
                  feedbackDes: "登录界面加载缓慢的问题",
                  customerName: "第一人民医院",
                  feedbackTime: "2023-10-24 10:00:00",
                  resolutionStatusName: "已解决",
                },
              ],
              total: 125,
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )

    const result = await VhoFeedbackService.search({
      phone: "13800138000",
      query: {
        feedback_id: "F1,F2",
        plan_id: "plan_123",
        feedback_des: "登录",
        resolution_status: "resolved",
        plan_start_date: "2026-03-01",
        plan_end_date: "2026-03-13",
        page_num: 2,
        page_size: 20,
      },
    })

    expect(result).toEqual({
      ok: true,
      login_info: {
        user_id: "13800138000",
        user_name: "系统管理员",
      },
      list: [
        {
          feedback_id: "F20231024001",
          plan_id: "plan_123",
          feedback_des: "登录界面加载缓慢的问题",
          customer_name: "第一人民医院",
          feedback_time: "2023-10-24 10:00:00",
          resolution_status_name: "已解决",
        },
      ],
      total: 125,
      page_num: 2,
      page_size: 20,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect((init as RequestInit | undefined)?.method).toBe("POST")
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual({
      userId: "13800138000",
      feedbackId: "F1,F2",
      planId: "plan_123",
      feedbackDes: "登录",
      resolutionStatus: "resolved",
      planStartDate: "2026-03-01",
      planEndDate: "2026-03-13",
      pageNum: 2,
      pageSize: 20,
    })
    fetch.mockRestore()
  })

  test("returns phone required error when search phone is missing", async () => {
    const result = await VhoFeedbackService.search({
      phone: "   ",
      query: {},
    })

    expect(result).toEqual({
      ok: false,
      code: "vho_feedback_phone_required",
      message: "请先绑定手机号后再查询反馈任务。",
    })
  })

  test("resolves prompt by plan id before falling back to feedback id", async () => {
    const now = Date.now()
    await seedSavedPlan({
      id: "plan_direct",
      vho_feedback_no: "F20231024001",
      plan_content: "直接命中的计划内容",
      time_created: now,
    })
    await seedSavedPlan({
      id: "plan_other",
      vho_feedback_no: "F20231024001",
      plan_content: "同反馈号但不该优先命中的内容",
      time_created: now + 1,
    })

    const result = await VhoFeedbackService.resolve({
      feedback_id: "F20231024001",
      plan_id: "plan_direct",
      feedback_des: "登录界面加载缓慢的问题",
    })

    expect(result).toEqual({
      ok: true,
      feedback_id: "F20231024001",
      plan_id: "plan_direct",
      feedback_des: "登录界面加载缓慢的问题",
      saved_plan_id: "plan_direct",
      plan_content: "直接命中的计划内容",
      matched_by: "plan_id",
      prompt_text: "反馈问题：登录界面加载缓慢的问题\n\n计划内容：直接命中的计划内容",
    })
  })

  test("falls back to latest saved plan by feedback id when plan id is absent", async () => {
    const now = Date.now()
    await seedSavedPlan({
      id: "plan_old",
      vho_feedback_no: "F20231024002",
      plan_content: "旧计划内容",
      time_created: now,
    })
    await seedSavedPlan({
      id: "plan_new",
      vho_feedback_no: "F20231024002",
      plan_content: "最新计划内容",
      time_created: now + 10,
    })

    const result = await VhoFeedbackService.resolve({
      feedback_id: "F20231024002",
      feedback_des: "处方保存失败",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    expect(result.saved_plan_id).toBe("plan_new")
    expect(result.plan_content).toBe("最新计划内容")
    expect(result.matched_by).toBe("feedback_id")

    const rows = await Database.use((db) =>
      db
        .select()
        .from(TpSavedPlanTable)
        .where(eq(TpSavedPlanTable.vho_feedback_no, "F20231024002"))
        .orderBy(desc(TpSavedPlanTable.time_created))
        .all(),
    )
    expect(rows[0]?.id).toBe("plan_new")
  })
})
