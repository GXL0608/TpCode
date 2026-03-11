import { describe, expect, test } from "bun:test"
import { getManagedCatalogState } from "./settings-providers-catalog"

describe("getManagedCatalogState", () => {
  test("only exposes configured providers and their models", () => {
    const state = getManagedCatalogState({
      providers: [
        {
          provider_id: "openai",
          provider_name: "OpenAI",
          models: [
            {
              model_id: "gpt-5.2-chat-latest",
              model_name: "GPT-5.2 Chat Latest",
            },
          ],
        },
        {
          provider_id: "anthropic",
          provider_name: "Anthropic",
          models: [
            {
              model_id: "claude-sonnet-4-20250514",
              model_name: "Claude Sonnet 4",
            },
          ],
        },
      ],
      model: "anthropic/claude-sonnet-4-20250514",
    })

    expect(state.providerOptions.map((item) => item.provider_id)).toEqual(["anthropic", "openai"])
    expect(state.selectedProviderID).toBe("anthropic")
    expect(state.selectedModelID).toBe("claude-sonnet-4-20250514")
    expect(state.selectedProviderModels.map((item) => item.model_id)).toEqual(["claude-sonnet-4-20250514"])
    expect(state.currentModelText).toBe("Anthropic / Claude Sonnet 4")
  })

  test("preserves current value text when configured provider is missing", () => {
    const state = getManagedCatalogState({
      providers: [
        {
          provider_id: "openai",
          provider_name: "OpenAI",
          models: [
            {
              model_id: "gpt-5.2-chat-latest",
              model_name: "GPT-5.2 Chat Latest",
            },
          ],
        },
      ],
      model: "anthropic/claude-sonnet-4-20250514",
    })

    expect(state.selectedProviderKnown).toBe(false)
    expect(state.selectedModelKnown).toBe(false)
    expect(state.currentModelText).toBe("anthropic/claude-sonnet-4-20250514")
  })
})
