import { describe, expect, test } from "bun:test"
import { appendRecognitionText, extractRecognitionSuffix, normalizeRecognitionText } from "./speech"

describe("speech transcript merge", () => {
  test("normalizes repeated whitespace", () => {
    expect(normalizeRecognitionText("  hello   world  ")).toBe("hello world")
  })

  test("joins latin segments with spaces", () => {
    expect(appendRecognitionText("hello", "world")).toBe("hello world")
  })

  test("joins CJK segments without synthetic spaces", () => {
    expect(appendRecognitionText("你好", "世界")).toBe("你好世界")
    expect(appendRecognitionText("こんにちは", "世界")).toBe("こんにちは世界")
  })

  test("extracts suffix when chinese hypothesis extends committed text", () => {
    expect(extractRecognitionSuffix("今天 天气", "今天天气不错")).toBe("不错")
    expect(extractRecognitionSuffix("你好", "你好世界")).toBe("世界")
  })

  test("treats a fresh stable phrase as new content after restart", () => {
    expect(extractRecognitionSuffix("你好世界", "今天继续")).toBe("今天继续")
  })

  test("does not duplicate text already covered by committed transcript", () => {
    expect(extractRecognitionSuffix("hello world", "world")).toBe("")
    expect(extractRecognitionSuffix("你好世界", "世界")).toBe("")
  })
})
