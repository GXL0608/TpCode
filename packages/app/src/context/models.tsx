import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useAccountAuth } from "./account-auth"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { useAccountRequest } from "@/components/settings-account-api"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"
type User = ModelKey & { visibility: Visibility; favorite?: boolean }
type Store = {
  user: User[]
  recent: ModelKey[]
  variant?: Record<string, string | undefined>
}

const RECENT_LIMIT = 5

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

function remoteKey(model: ModelKey) {
  return `${model.providerID}/${model.modelID}`
}

function parseKey(input: string) {
  const hasColon = input.includes(":")
  if (hasColon) {
    const idx = input.indexOf(":")
    if (idx > 0) return { providerID: input.slice(0, idx), modelID: input.slice(idx + 1) }
  }
  const [providerID, ...rest] = input.split("/")
  if (!providerID || rest.length === 0) return
  return { providerID, modelID: rest.join("/") }
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  init: () => {
    const auth = useAccountAuth()
    const accountRequest = useAccountRequest()
    const accountID = auth.user()?.id ?? "anonymous"
    const providers = useProviders()
    const [loaded, setLoaded] = createSignal(false)

    const [store, setStore, _, ready] = persisted(
      Persist.global(`acct:${accountID}:model`),
      createStore<Store>({
        user: [],
        recent: [],
        variant: {},
      }),
    )

    const readyState = createMemo(() => {
      if (!auth.enabled()) return ready()
      return ready() && loaded()
    })

    function encode() {
      const visibility = store.user.reduce(
        (acc, item) => {
          acc[remoteKey(item)] = item.visibility
          return acc
        },
        {} as Record<string, "show" | "hide">,
      )
      const favorite = store.user.filter((x) => x.favorite).map(remoteKey)
      return {
        visibility,
        favorite,
        recent: store.recent.map(remoteKey),
        variant: store.variant ?? {},
      }
    }

    function decode(input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return
      const row = input as {
        visibility?: unknown
        favorite?: unknown
        recent?: unknown
        variant?: unknown
      }
      const fav = new Set(
        (Array.isArray(row.favorite) ? row.favorite : [])
          .map((x) => (typeof x === "string" ? parseKey(x) : undefined))
          .filter((x): x is ModelKey => !!x)
          .map(modelKey),
      )
      const user = Object.entries(
        row.visibility && typeof row.visibility === "object" && !Array.isArray(row.visibility) ? row.visibility : {},
      ).flatMap(([key, value]) => {
        const parsed = parseKey(key)
        if (!parsed) return []
        if (value !== "show" && value !== "hide") return []
        return [
          {
            ...parsed,
            visibility: value,
            favorite: fav.has(modelKey(parsed)),
          },
        ]
      })
      const recent = (Array.isArray(row.recent) ? row.recent : []).flatMap((x) => {
        if (typeof x !== "string") return []
        const parsed = parseKey(x)
        if (!parsed) return []
        return [parsed]
      })
      const variant = row.variant && typeof row.variant === "object" && !Array.isArray(row.variant) ? row.variant : {}
      setStore("user", user)
      setStore("recent", recent)
      setStore("variant", variant as Record<string, string | undefined>)
    }

    createEffect(() => {
      if (!auth.enabled()) {
        setLoaded(false)
        return
      }
      const user = auth.user()
      if (!user?.id) return
      let done = false
      void accountRequest({
        path: "/account/me/model-prefs",
      })
        .then((response) => {
          if (!response?.ok) return
          return response.json().catch(() => undefined)
        })
        .then((body) => {
          if (done) return
          decode(body)
          setLoaded(true)
        })
        .catch(() => {
          if (done) return
          setLoaded(true)
        })
      onCleanup(() => {
        done = true
      })
    })

    createEffect(() => {
      if (!auth.enabled()) return
      if (!loaded()) return
      const body = encode()
      const timer = setTimeout(() => {
        void accountRequest({
          method: "PUT",
          path: "/account/me/model-prefs",
          body: body as unknown as Record<string, unknown>,
        })
      }, 150)
      onCleanup(() => {
        clearTimeout(timer)
      })
    })

    const available = createMemo(() =>
      providers.connected().flatMap((p) =>
        Object.values(p.models).map((m) => ({
          ...m,
          provider: p,
        })),
      ),
    )

    const release = createMemo(
      () =>
        new Map(
          available().map((model) => {
            const parsed = DateTime.fromISO(model.release_date)
            return [modelKey({ providerID: model.provider.id, modelID: model.id }), parsed] as const
          }),
        ),
    )

    const latest = createMemo(() =>
      pipe(
        available(),
        filter(
          (x) =>
            Math.abs(
              (release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? DateTime.invalid("invalid"))
                .diffNow()
                .as("months"),
            ) < 6,
        ),
        groupBy((x) => x.provider.id),
        mapValues((models) =>
          pipe(
            models,
            groupBy((x) => x.family),
            values(),
            (groups) =>
              groups.flatMap((g) => {
                const first = firstBy(g, [(x) => x.release_date, "desc"])
                return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
              }),
          ),
        ),
        values(),
        flat(),
      ),
    )

    const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

    const visibility = createMemo(() => {
      const map = new Map<string, Visibility>()
      for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)
      return map
    })

    const list = createMemo(() =>
      available().map((m) => ({
        ...m,
        name: m.name.replace("(latest)", "").trim(),
        latest: m.name.includes("(latest)"),
      })),
    )

    const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

    function update(model: ModelKey, state: Visibility) {
      const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
      if (index >= 0) {
        setStore("user", index, (current) => ({ ...current, visibility: state }))
        return
      }
      setStore("user", store.user.length, { ...model, visibility: state })
    }

    const visible = (model: ModelKey) => {
      const key = modelKey(model)
      const state = visibility().get(key)
      if (state === "hide") return false
      if (state === "show") return true
      if (latestSet().has(key)) return true
      const date = release().get(key)
      if (!date?.isValid) return true
      return false
    }

    const setVisibility = (model: ModelKey, state: boolean) => {
      update(model, state ? "show" : "hide")
    }

    const push = (model: ModelKey) => {
      const uniq = uniqueBy([model, ...store.recent], (x) => `${x.providerID}:${x.modelID}`)
      if (uniq.length > RECENT_LIMIT) uniq.pop()
      setStore("recent", uniq)
    }

    const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
    const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

    const setVariant = (model: ModelKey, value: string | undefined) => {
      const key = variantKey(model)
      if (!store.variant) {
        setStore("variant", { [key]: value })
        return
      }
      setStore("variant", key, value)
    }

      return {
      ready: readyState,
      list,
      find,
      visible,
      setVisibility,
      recent: {
        list: createMemo(() => store.recent),
        push,
      },
      variant: {
        get: getVariant,
        set: setVariant,
      },
    }
  },
})
