import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "bs"
  | "tr"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "bs",
  "ar",
  "no",
  "br",
  "th",
  "tr",
]

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
  en: "language.en",
  zh: "language.zh",
  zht: "language.zht",
  ko: "language.ko",
  de: "language.de",
  es: "language.es",
  fr: "language.fr",
  da: "language.da",
  ja: "language.ja",
  pl: "language.pl",
  ru: "language.ru",
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

const base = i18n.flatten({ ...en, ...uiEn })
type DictModule = { dict: Record<string, unknown> }

function merge(app: DictModule, ui: DictModule): Dictionary {
  return {
    ...base,
    ...i18n.flatten({
      ...app.dict,
      ...ui.dict,
    }),
  }
}

const loaders: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  zh: () => Promise.all([import("@/i18n/zh"), import("@opencode-ai/ui/i18n/zh")]).then(([app, ui]) => merge(app, ui)),
  zht: () => Promise.all([import("@/i18n/zht"), import("@opencode-ai/ui/i18n/zht")]).then(([app, ui]) => merge(app, ui)),
  ko: () => Promise.all([import("@/i18n/ko"), import("@opencode-ai/ui/i18n/ko")]).then(([app, ui]) => merge(app, ui)),
  de: () => Promise.all([import("@/i18n/de"), import("@opencode-ai/ui/i18n/de")]).then(([app, ui]) => merge(app, ui)),
  es: () => Promise.all([import("@/i18n/es"), import("@opencode-ai/ui/i18n/es")]).then(([app, ui]) => merge(app, ui)),
  fr: () => Promise.all([import("@/i18n/fr"), import("@opencode-ai/ui/i18n/fr")]).then(([app, ui]) => merge(app, ui)),
  da: () => Promise.all([import("@/i18n/da"), import("@opencode-ai/ui/i18n/da")]).then(([app, ui]) => merge(app, ui)),
  ja: () => Promise.all([import("@/i18n/ja"), import("@opencode-ai/ui/i18n/ja")]).then(([app, ui]) => merge(app, ui)),
  pl: () => Promise.all([import("@/i18n/pl"), import("@opencode-ai/ui/i18n/pl")]).then(([app, ui]) => merge(app, ui)),
  ru: () => Promise.all([import("@/i18n/ru"), import("@opencode-ai/ui/i18n/ru")]).then(([app, ui]) => merge(app, ui)),
  ar: () => Promise.all([import("@/i18n/ar"), import("@opencode-ai/ui/i18n/ar")]).then(([app, ui]) => merge(app, ui)),
  no: () => Promise.all([import("@/i18n/no"), import("@opencode-ai/ui/i18n/no")]).then(([app, ui]) => merge(app, ui)),
  br: () => Promise.all([import("@/i18n/br"), import("@opencode-ai/ui/i18n/br")]).then(([app, ui]) => merge(app, ui)),
  th: () => Promise.all([import("@/i18n/th"), import("@opencode-ai/ui/i18n/th")]).then(([app, ui]) => merge(app, ui)),
  bs: () => Promise.all([import("@/i18n/bs"), import("@opencode-ai/ui/i18n/bs")]).then(([app, ui]) => merge(app, ui)),
  tr: () => Promise.all([import("@/i18n/tr"), import("@opencode-ai/ui/i18n/tr")]).then(([app, ui]) => merge(app, ui)),
}

function load(locale: Locale) {
  if (locale === "en") return Promise.resolve(base)
  return loaders[locale]()
}

const localeMatchers: Array<{ locale: Locale; match: (language: string) => boolean }> = [
  { locale: "zht", match: (language) => language.startsWith("zh") && language.includes("hant") },
  { locale: "zh", match: (language) => language.startsWith("zh") },
  { locale: "ko", match: (language) => language.startsWith("ko") },
  { locale: "de", match: (language) => language.startsWith("de") },
  { locale: "es", match: (language) => language.startsWith("es") },
  { locale: "fr", match: (language) => language.startsWith("fr") },
  { locale: "da", match: (language) => language.startsWith("da") },
  { locale: "ja", match: (language) => language.startsWith("ja") },
  { locale: "pl", match: (language) => language.startsWith("pl") },
  { locale: "ru", match: (language) => language.startsWith("ru") },
  { locale: "ar", match: (language) => language.startsWith("ar") },
  {
    locale: "no",
    match: (language) => language.startsWith("no") || language.startsWith("nb") || language.startsWith("nn"),
  },
  { locale: "br", match: (language) => language.startsWith("pt") },
  { locale: "th", match: (language) => language.startsWith("th") },
  { locale: "bs", match: (language) => language.startsWith("bs") },
  { locale: "tr", match: (language) => language.startsWith("tr") },
]

type ParityKey = "command.session.previous.unseen" | "command.session.next.unseen"
const PARITY_CHECK: Record<Exclude<Locale, "en">, Record<ParityKey, string>> | undefined = undefined
void PARITY_CHECK

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    const normalized = language.toLowerCase()
    const match = localeMatchers.find((entry) => entry.match(normalized))
    if (match) return match.locale
  }

  return "en"
}

function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: detectLocale() as Locale,
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))

    const [cache, setCache] = createStore<Partial<Record<Locale, Dictionary>>>({
      en: base,
    })
    const pending = new Map<Locale, Promise<void>>()

    const ensure = (target: Locale) => {
      if (cache[target]) return Promise.resolve()
      const queued = pending.get(target)
      if (queued) return queued
      const task = load(target)
        .then((dict) => {
          setCache(target, dict)
        })
        .catch(() => undefined)
        .finally(() => {
          pending.delete(target)
        })
      pending.set(target, task)
      return task
    }

    createEffect(() => {
      const target = locale()
      void ensure(target)
    })

    const dict = createMemo<Dictionary>(() => cache[locale()] ?? cache.en ?? base)

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      document.cookie = cookie(locale())
    })

    return {
      ready,
      locale,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        const target = normalizeLocale(next)
        if (target === locale()) return
        void ensure(target).finally(() => {
          setStore("locale", target)
        })
      },
    }
  },
})
