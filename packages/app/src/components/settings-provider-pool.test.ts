import { describe, expect, test } from "bun:test"
import { normalizePool, validatePool, validatePoolControl } from "./settings-provider-pool"

describe("settings-provider-pool", () => {
  test("normalizes provider and model weights", () => {
    const result = normalizePool([
      {
        provider_id: "openai",
        weight: "3",
        models: [
          { model_id: "gpt-5.2-chat-latest", weight: "4" },
          { model_id: "gpt-4.1-mini", weight: "1" },
        ],
      },
    ])

    expect(result).toEqual([
      {
        provider_id: "openai",
        weight: 3,
        models: [
          { model_id: "gpt-5.2-chat-latest", weight: 4 },
          { model_id: "gpt-4.1-mini", weight: 1 },
        ],
      },
    ])
  })

  test("rejects duplicate providers, duplicate models, and invalid weights", () => {
    expect(
      validatePool([
        {
          provider_id: "openai",
          weight: "0",
          models: [{ model_id: "gpt-5.2-chat-latest", weight: "1" }],
        },
        {
          provider_id: "openai",
          weight: "1",
          models: [
            { model_id: "gpt-4.1-mini", weight: "1" },
            { model_id: "gpt-4.1-mini", weight: "2" },
          ],
        },
      ]),
    ).toEqual({
      ok: false,
      errors: [
        "渠道权重必须是正整数",
        "渠道不能重复",
        "同一渠道下模型不能重复",
      ],
    })
  })

  test("requires fallback model when pool is configured", () => {
    expect(
      validatePoolControl({
        model: "",
        pool: [
          {
            provider_id: "openai",
            weight: "1",
            models: [{ model_id: "gpt-5.2-chat-latest", weight: "1" }],
          },
        ],
      }),
    ).toEqual({
      ok: false,
      errors: ["当前模型不能为空，作为 Session 模型池回退项使用"],
    })
  })
})
