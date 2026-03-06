import { createHash } from "crypto"

export enum WatermarkType {
  COMMENT = "comment", // 注释水印
  IDENTIFIER = "identifier", // 标识符水印
  WHITESPACE = "whitespace", // 空白字符水印
  STRUCTURE = "structure", // 代码结构水印
}

export type WatermarkStrength = "low" | "medium" | "high"

export interface WatermarkConfigOptions {
  enabled: boolean
  type: WatermarkType
  strength: WatermarkStrength
  customPayload?: Record<string, any>
}

export class WatermarkConfig {
  public readonly enabled: boolean
  public readonly type: WatermarkType
  public readonly strength: WatermarkStrength
  public readonly customPayload?: Record<string, any>

  constructor(options: WatermarkConfigOptions) {
    this.validateStrength(options.strength)
    this.enabled = options.enabled
    this.type = options.type
    this.strength = options.strength
    this.customPayload = options.customPayload
  }

  static default(): WatermarkConfig {
    return new WatermarkConfig({
      enabled: true,
      type: WatermarkType.COMMENT,
      strength: "medium",
    })
  }

  static generateWatermarkId(userId: string, sessionId: string): string {
    const timestamp = Date.now()
    const payload = `${userId}:${sessionId}:${timestamp}`
    return createHash("sha256").update(payload).digest("hex").substring(0, 16)
  }

  private validateStrength(strength: string): void {
    const validStrengths = ["low", "medium", "high"]
    if (!validStrengths.includes(strength)) {
      throw new Error(`Invalid watermark strength: ${strength}`)
    }
  }

  getStrengthMultiplier(): number {
    switch (this.strength) {
      case "low":
        return 1
      case "medium":
        return 2
      case "high":
        return 3
    }
  }
}
