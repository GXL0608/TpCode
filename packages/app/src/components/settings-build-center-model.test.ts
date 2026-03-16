import { describe, expect, test } from "bun:test"
import { buildBuildCenterModelOptions, buildBuildCenterJobBody } from "./settings-build-center-model"

describe("settings-build-center-model", () => {
  test("builds model selector options with an automatic fallback entry", () => {
    expect(
      buildBuildCenterModelOptions([
        {
          value: "openai/gpt-5.2",
          source: "global",
        },
        {
          value: "openrouter/openai/gpt-4o-mini",
          source: "pool",
        },
      ]),
    ).toEqual([
      {
        value: "__auto__",
        label: "系统自动",
      },
      {
        value: "openai/gpt-5.2",
        label: "系统指定 · openai/gpt-5.2",
      },
      {
        value: "openrouter/openai/gpt-4o-mini",
        label: "系统模型池 · openrouter/openai/gpt-4o-mini",
      },
    ])
  })

  test("includes explicit runtime model when submitting build-center jobs", () => {
    expect(
      buildBuildCenterJobBody({
        product_id: "product-1",
        solution_id: "solution-1",
        saved_plan_ids: ["plan-1", "plan-2"],
        model: "openrouter/openai/gpt-4o-mini",
      }),
    ).toEqual({
      product_id: "product-1",
      solution_id: "solution-1",
      saved_plan_ids: ["plan-1", "plan-2"],
      run_mode: "async",
      providerID: "openrouter",
      modelID: "openai/gpt-4o-mini",
    })
  })

  test("omits runtime model when the selector stays on automatic mode", () => {
    expect(
      buildBuildCenterJobBody({
        product_id: "product-1",
        solution_id: "",
        saved_plan_ids: ["plan-1"],
        model: "__auto__",
      }),
    ).toEqual({
      product_id: "product-1",
      solution_id: undefined,
      saved_plan_ids: ["plan-1"],
      run_mode: "async",
      providerID: undefined,
      modelID: undefined,
    })
  })
})
