import { describe, test, expect } from "bun:test"
import { WatermarkConfig, WatermarkType } from "./watermark-config"

describe("WatermarkConfig", () => {
  test("should create default config", () => {
    const config = WatermarkConfig.default()

    expect(config.enabled).toBe(true)
    expect(config.type).toBe(WatermarkType.COMMENT)
    expect(config.strength).toBe("medium")
  })

  test("should validate watermark strength", () => {
    expect(() => {
      new WatermarkConfig({
        enabled: true,
        type: WatermarkType.COMMENT,
        strength: "invalid" as any,
      })
    }).toThrow("Invalid watermark strength")
  })

  test("should support multiple watermark types", () => {
    const types = [
      WatermarkType.COMMENT,
      WatermarkType.IDENTIFIER,
      WatermarkType.WHITESPACE,
      WatermarkType.STRUCTURE,
    ]

    types.forEach((type) => {
      const config = new WatermarkConfig({
        enabled: true,
        type,
        strength: "medium",
      })
      expect(config.type).toBe(type)
    })
  })

  test("should generate unique watermark ID", () => {
    const id1 = WatermarkConfig.generateWatermarkId("user-1", "session-1")
    const id2 = WatermarkConfig.generateWatermarkId("user-1", "session-2")
    const id3 = WatermarkConfig.generateWatermarkId("user-2", "session-1")

    expect(id1).not.toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id2).not.toBe(id3)
  })
})
