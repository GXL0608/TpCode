import { WatermarkConfig, WatermarkType } from "./watermark-config"

export interface WatermarkLocation {
  line: number
  column: number
  type: WatermarkType
  fragment: string
}

export interface EmbedResult {
  watermarked: string
  locations: WatermarkLocation[]
  originalLength: number
  watermarkedLength: number
}

export class WatermarkEmbedder {
  embed(code: string, watermarkId: string, config: WatermarkConfig): EmbedResult {
    if (!config.enabled) {
      return {
        watermarked: code,
        locations: [],
        originalLength: code.length,
        watermarkedLength: code.length,
      }
    }

    const locations: WatermarkLocation[] = []
    let watermarked = code

    switch (config.type) {
      case WatermarkType.COMMENT:
        watermarked = this.embedCommentWatermark(code, watermarkId, config, locations)
        break
      case WatermarkType.IDENTIFIER:
        watermarked = this.embedIdentifierWatermark(code, watermarkId, config, locations)
        break
      case WatermarkType.WHITESPACE:
        watermarked = this.embedWhitespaceWatermark(code, watermarkId, config, locations)
        break
      case WatermarkType.STRUCTURE:
        watermarked = this.embedStructureWatermark(code, watermarkId, config, locations)
        break
    }

    return {
      watermarked,
      locations,
      originalLength: code.length,
      watermarkedLength: watermarked.length,
    }
  }

  private embedCommentWatermark(
    code: string,
    watermarkId: string,
    config: WatermarkConfig,
    locations: WatermarkLocation[]
  ): string {
    const lines = code.split("\n")
    const multiplier = config.getStrengthMultiplier()
    const insertInterval = Math.max(1, Math.floor(lines.length / (2 * multiplier)))

    for (let i = 0; i < lines.length; i += insertInterval) {
      if (i === 0 || lines[i].trim().length === 0) continue

      const indent = lines[i].match(/^\s*/)?.[0] || ""
      const fragment = `${indent}// wm:${watermarkId.substring(i % watermarkId.length, (i % watermarkId.length) + 4)}`

      lines.splice(i, 0, fragment)
      locations.push({
        line: i + 1,
        column: indent.length,
        type: WatermarkType.COMMENT,
        fragment,
      })

      i++ // Skip the inserted line
    }

    return lines.join("\n")
  }

  private embedIdentifierWatermark(
    code: string,
    watermarkId: string,
    config: WatermarkConfig,
    locations: WatermarkLocation[]
  ): string {
    // 在临时变量名中嵌入水印片段
    const tempVarPattern = /\b(temp|tmp|t|_)\b/g
    let match
    let result = code
    let offset = 0

    while ((match = tempVarPattern.exec(code)) !== null) {
      const original = match[0]
      const fragment = watermarkId.substring(0, 3)
      const replacement = `${original}_${fragment}`

      result =
        result.substring(0, match.index + offset) +
        replacement +
        result.substring(match.index + offset + original.length)

      locations.push({
        line: code.substring(0, match.index).split("\n").length,
        column: match.index - code.lastIndexOf("\n", match.index),
        type: WatermarkType.IDENTIFIER,
        fragment: replacement,
      })

      offset += replacement.length - original.length
    }

    return result
  }

  private embedWhitespaceWatermark(
    code: string,
    watermarkId: string,
    config: WatermarkConfig,
    locations: WatermarkLocation[]
  ): string {
    // 使用空格/制表符的数量编码水印
    const lines = code.split("\n")
    const binaryWatermark = this.stringToBinary(watermarkId)
    let bitIndex = 0

    for (let i = 0; i < lines.length && bitIndex < binaryWatermark.length; i++) {
      const line = lines[i]
      if (line.trim().length === 0) continue

      const indent = line.match(/^\s*/)?.[0] || ""
      const bit = binaryWatermark[bitIndex]

      // 0 = 偶数空格, 1 = 奇数空格
      const targetSpaces = bit === "0" ? 2 : 3
      const newIndent = " ".repeat(targetSpaces)

      lines[i] = newIndent + line.trimStart()
      locations.push({
        line: i + 1,
        column: 0,
        type: WatermarkType.WHITESPACE,
        fragment: newIndent,
      })

      bitIndex++
    }

    return lines.join("\n")
  }

  private embedStructureWatermark(
    code: string,
    watermarkId: string,
    config: WatermarkConfig,
    locations: WatermarkLocation[]
  ): string {
    // 通过添加无意义但合法的代码结构嵌入水印
    const lines = code.split("\n")
    const fragment = `if (false) { /* ${watermarkId.substring(0, 8)} */ }`

    // 在函数体开始处插入
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("{") && !lines[i].trim().startsWith("//")) {
        const indent = lines[i].match(/^\s*/)?.[0] || ""
        lines.splice(i + 1, 0, `${indent}  ${fragment}`)

        locations.push({
          line: i + 2,
          column: indent.length + 2,
          type: WatermarkType.STRUCTURE,
          fragment,
        })

        break
      }
    }

    return lines.join("\n")
  }

  private stringToBinary(str: string): string {
    return str
      .split("")
      .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
      .join("")
  }
}
