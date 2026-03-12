import { describe, expect, test } from "bun:test"
import { buildProviderControl, parseProviderList } from "./settings-provider-control"

describe("settings-provider-control", () => {
  test("parses provider list", () => {
    expect(parseProviderList(" openai, anthropic ,, ")).toEqual(["openai", "anthropic"])
  })

  test("auto-enables providers referenced by current model", () => {
    expect(
      buildProviderControl({
        model: "anthropic/claude-sonnet-4",
        smallModel: "",
        sessionModelPool: [],
        enabledProviders: "openai",
        disabledProviders: "",
      }),
    ).toEqual({
      model: "anthropic/claude-sonnet-4",
      small_model: undefined,
      session_model_pool: undefined,
      enabled_providers: ["openai", "anthropic"],
      disabled_providers: undefined,
    })
  })

  test("removes referenced providers from disabled list", () => {
    expect(
      buildProviderControl({
        model: "anthropic/claude-sonnet-4",
        smallModel: "openai/gpt-5",
        sessionModelPool: [
          {
            provider_id: "google",
            weight: "1",
            models: [{ model_id: "gemini-2.5-pro", weight: "1" }],
          },
        ],
        enabledProviders: "",
        disabledProviders: "anthropic, google, mistral",
      }),
    ).toEqual({
      model: "anthropic/claude-sonnet-4",
      small_model: "openai/gpt-5",
      session_model_pool: [
        {
          provider_id: "google",
          weight: 1,
          models: [{ model_id: "gemini-2.5-pro", weight: 1 }],
        },
      ],
      enabled_providers: ["anthropic", "openai", "google"],
      disabled_providers: ["mistral"],
    })
  })

  test("drops stale providers that are no longer configured", () => {
    expect(
      buildProviderControl({
        model: "tphy/MiniMax-M2.5",
        smallModel: "",
        sessionModelPool: [],
        enabledProviders: "opencode",
        disabledProviders: "opencode,anthropic",
        configuredProviders: ["tphy", "anthropic"],
      }),
    ).toEqual({
      model: "tphy/MiniMax-M2.5",
      small_model: undefined,
      session_model_pool: undefined,
      enabled_providers: ["tphy"],
      disabled_providers: ["anthropic"],
    })
  })
})
