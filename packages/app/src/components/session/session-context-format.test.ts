import { afterEach, describe, expect, test } from "bun:test"
import {
  createCurrencyFormatter,
  createSessionContextFormatter,
  formatSessionContextCurrency,
  readSessionContextLocale,
  resolveSessionContextLocale,
} from "./session-context-format"

const originalNumberFormat = Intl.NumberFormat

afterEach(() => {
  Intl.NumberFormat = originalNumberFormat
})

describe("session context format", () => {
  test("returns fallback currency formatter when Intl.NumberFormat throws", () => {
    Intl.NumberFormat = class {
      /** 中文注释：测试里主动抛错，模拟异常运行时环境。 */
      constructor() {
        throw new Error("boom")
      }
    } as unknown as typeof Intl.NumberFormat

    const formatter = createCurrencyFormatter("zh")

    expect(formatter.format(12.3456)).toBe("USD 12.3456")
    expect((formatter as { format(value: number | undefined): string }).format(undefined)).toBe("—")
  })

  test("keeps number and time formatter behavior stable", () => {
    const formatter = createSessionContextFormatter("zh")

    expect(formatter.number(1234)).toContain("1")
    expect(formatter.number(undefined)).toBe("—")
    expect(formatter.percent(25)).toContain("25")
    expect(formatter.time(undefined)).toBe("—")
  })

  test("falls back to english when locale input is missing or invalid", () => {
    expect(resolveSessionContextLocale(undefined)).toBe("en")
    expect(resolveSessionContextLocale("")).toBe("en")
    expect(readSessionContextLocale(undefined)).toBe("en")
    expect(
      readSessionContextLocale(() => {
        throw new Error("boom")
      }),
    ).toBe("en")
  })

  test("keeps currency formatting callable even when locale accessor is unstable", () => {
    const formatter = createCurrencyFormatter(readSessionContextLocale(undefined))
    expect(formatter.format(12.34)).toContain("12")
  })

  test("formats currency directly without exposing a formatter object to callers", () => {
    expect(formatSessionContextCurrency(undefined, 12.34)).toContain("12")
    expect(formatSessionContextCurrency("", undefined)).toBe("—")
  })
})
