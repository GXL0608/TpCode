import { describe, expect, test } from "bun:test"
import { hasPromptText, shouldClearVoiceDraft, shouldResetPromptDraft } from "./draft"

describe("prompt-input draft", () => {
  test("treats zero-width-only content as empty", () => {
    expect(hasPromptText(" \n\u200B\t")).toBe(false)
    expect(hasPromptText("hello")).toBe(true)
  })

  test("resets an empty draft with no media", () => {
    expect(
      shouldResetPromptDraft({
        raw: "",
        has_non_text: false,
        image_count: 0,
        voice_count: 0,
      }),
    ).toBe(true)
  })

  test("clears voice draft when text is deleted and only voice remains", () => {
    expect(
      shouldClearVoiceDraft({
        raw: "",
        has_non_text: false,
        image_count: 0,
        voice_count: 1,
      }),
    ).toBe(true)
  })

  test("keeps voice draft when visible text still exists", () => {
    expect(
      shouldClearVoiceDraft({
        raw: "voice text",
        has_non_text: false,
        image_count: 0,
        voice_count: 1,
      }),
    ).toBe(false)
  })

  test("keeps image-only drafts intact", () => {
    expect(
      shouldResetPromptDraft({
        raw: "",
        has_non_text: false,
        image_count: 1,
        voice_count: 0,
      }),
    ).toBe(false)
    expect(
      shouldClearVoiceDraft({
        raw: "",
        has_non_text: false,
        image_count: 1,
        voice_count: 1,
      }),
    ).toBe(false)
  })
})
