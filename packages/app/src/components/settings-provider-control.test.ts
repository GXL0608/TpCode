import { describe, expect, test } from "bun:test"
import { buildProviderControl, draftProviderControl, parseProviderList } from "./settings-provider-control"

describe("settings-provider-control", () => {
  test("parses provider list", () => {
    expect(parseProviderList(" openai, anthropic ,, ")).toEqual(["openai", "anthropic"])
  })

  test("auto-enables providers referenced by current model", () => {
    expect(
      buildProviderControl({
        model: "anthropic/claude-sonnet-4",
        smallModel: "",
        mirrorModel: "",
        sessionModelPool: [],
        enabledProviders: "openai",
        disabledProviders: "",
      }),
    ).toEqual({
      mirror_model: undefined,
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
        mirrorModel: "google/gemini-2.5-pro",
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
      mirror_model: {
        provider_id: "google",
        model_id: "gemini-2.5-pro",
      },
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
        mirrorModel: "openai/gpt-5",
        sessionModelPool: [],
        enabledProviders: "opencode",
        disabledProviders: "opencode,anthropic",
        configuredProviders: ["tphy", "anthropic"],
      }),
    ).toEqual({
      mirror_model: undefined,
      model: "tphy/MiniMax-M2.5",
      small_model: undefined,
      session_model_pool: undefined,
      enabled_providers: ["tphy"],
      disabled_providers: ["anthropic"],
    })
  })

  test("drafts provider control from api payload", () => {
    expect(
      draftProviderControl({
        mirror_model: {
          provider_id: "anthropic",
          model_id: "claude-sonnet-4-20250514",
        },
        model: "openai/gpt-5.2-chat-latest",
        small_model: "openai/gpt-4.1-mini",
        session_model_pool: [
          {
            provider_id: "google",
            weight: 2,
            models: [{ model_id: "gemini-2.5-pro", weight: 3 }],
          },
        ],
        enabled_providers: ["openai", "anthropic"],
        disabled_providers: ["mistral"],
      }),
    ).toEqual({
      mirrorModel: "anthropic/claude-sonnet-4-20250514",
      model: "openai/gpt-5.2-chat-latest",
      smallModel: "openai/gpt-4.1-mini",
      sessionModelPool: [
        {
          provider_id: "google",
          weight: "2",
          models: [{ model_id: "gemini-2.5-pro", weight: "3" }],
        },
      ],
      enabledProviders: "openai, anthropic",
      disabledProviders: "mistral",
    })
  })
})
