import { describe, test, expect } from "bun:test"
import { WatermarkEmbedder } from "./watermark-embedder"
import { WatermarkConfig, WatermarkType } from "./watermark-config"

describe("WatermarkEmbedder", () => {
  test("should embed comment watermark", () => {
    const embedder = new WatermarkEmbedder()
    const config = new WatermarkConfig({
      enabled: true,
      type: WatermarkType.COMMENT,
      strength: "medium",
    })

    const code = `function hello() {
  console.log("Hello")
}`

    const watermarkId = "abc123def456"
    const result = embedder.embed(code, watermarkId, config)

    expect(result.watermarked).toContain("wm:")
    expect(result.watermarked).toContain("function hello()")
    expect(result.locations.length).toBeGreaterThan(0)
    expect(result.locations[0].type).toBe(WatermarkType.COMMENT)
  })

  test("should embed identifier watermark", () => {
    const embedder = new WatermarkEmbedder()
    const config = new WatermarkConfig({
      enabled: true,
      type: WatermarkType.IDENTIFIER,
      strength: "low",
    })

    const code = `const temp = 123`
    const watermarkId = "xyz789"
    const result = embedder.embed(code, watermarkId, config)

    expect(result.watermarked).not.toBe(code)
    expect(result.locations.length).toBeGreaterThan(0)
  })

  test("should not embed when disabled", () => {
    const embedder = new WatermarkEmbedder()
    const config = new WatermarkConfig({
      enabled: false,
      type: WatermarkType.COMMENT,
      strength: "medium",
    })

    const code = `function test() {}`
    const result = embedder.embed(code, "watermark-id", config)

    expect(result.watermarked).toBe(code)
    expect(result.locations.length).toBe(0)
  })

  test("should respect strength multiplier", () => {
    const embedder = new WatermarkEmbedder()
    const lowConfig = new WatermarkConfig({
      enabled: true,
      type: WatermarkType.COMMENT,
      strength: "low",
    })
    const highConfig = new WatermarkConfig({
      enabled: true,
      type: WatermarkType.COMMENT,
      strength: "high",
    })

    const code = `function test() {\n  return 42\n}`
    const watermarkId = "test123"

    const lowResult = embedder.embed(code, watermarkId, lowConfig)
    const highResult = embedder.embed(code, watermarkId, highConfig)

    expect(highResult.locations.length).toBeGreaterThanOrEqual(lowResult.locations.length)
  })
})
