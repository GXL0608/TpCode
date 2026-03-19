import { DateTime } from "luxon"

type CurrencyFormatter = {
  format(value: number | null | undefined): string
}

/** 中文注释：把可能异常的 locale 输入收敛成稳定可用的语言值。 */
export function resolveSessionContextLocale(locale: unknown) {
  if (typeof locale !== "string") return "en"
  if (!locale.trim()) return "en"
  return locale
}

/** 中文注释：安全读取语言上下文里的 locale，避免上下文切换瞬间把页面炸掉。 */
export function readSessionContextLocale(locale: unknown) {
  if (typeof locale !== "function") return "en"
  try {
    return resolveSessionContextLocale(locale())
  } catch {
    return "en"
  }
}

/** 中文注释：创建货币格式化器；即便运行时国际化对象异常，也要返回可用的兜底格式化函数。 */
export function createCurrencyFormatter(locale: unknown, currency = "USD"): CurrencyFormatter {
  const target = resolveSessionContextLocale(locale)
  try {
    return new Intl.NumberFormat(target, {
      style: "currency",
      currency,
    })
  } catch {
    return {
      format(value: number | null | undefined) {
        if (value === undefined) return "—"
        if (value === null) return "—"
        if (!Number.isFinite(value)) return "—"
        return `${currency} ${value.toFixed(4)}`
      },
    }
  }
}

/** 中文注释：直接返回安全的货币展示文本，避免组件层拿到格式化器对象后再发生空引用。 */
export function formatSessionContextCurrency(locale: unknown, value: number | null | undefined, currency = "USD") {
  if (value === undefined) return "—"
  if (value === null) return "—"
  if (!Number.isFinite(value)) return "—"
  return createCurrencyFormatter(locale, currency).format(value)
}

/** 中文注释：创建会话上下文里的通用数字、百分比和时间格式化器。 */
export function createSessionContextFormatter(locale: unknown) {
  const target = resolveSessionContextLocale(locale)
  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(target)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(target) + "%"
    },
    time(value: number | undefined) {
      if (!value) return "—"
      return DateTime.fromMillis(value).setLocale(target).toLocaleString(DateTime.DATETIME_MED)
    },
  }
}
