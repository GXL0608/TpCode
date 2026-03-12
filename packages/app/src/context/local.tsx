import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"
import { useAccountAuth } from "./account-auth"
import { canUseBuildCapability } from "@/utils/account-build-access"

export type ModelKey = { providerID: string; modelID: string }

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()
    const account = useAccountAuth()
    const strictGlobal = createMemo(() => account.authenticated() && !canUseBuildCapability(account.user()))
    const connected = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))

    function parseConfigured(value: string | undefined) {
      if (!value) return
      const [providerID, ...rest] = value.split("/")
      const modelID = rest.join("/")
      if (!providerID || !modelID) return
      return { providerID, modelID }
    }

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    let setModel: (model: ModelKey | undefined, options?: { recent?: boolean }) => void = () => undefined

    const agent = (() => {
      const list = createMemo(() =>
        sync.data.agent.filter((x) => {
          if (x.mode === "subagent") return false
          if (x.name === "plan") return true
          if (x.hidden) return false
          return true
        }),
      )
      const first = (items: ReturnType<typeof list>) => items.find((x) => x.name === "plan") ?? items[0]
      const [store, setStore] = createStore<{
        current?: string
      }>({
        current: first(list())?.name,
      })
      return {
        list,
        current() {
          const available = list()
          if (available.length === 0) return undefined
          return available.find((x) => x.name === store.current) ?? first(available)
        },
        set(name: string | undefined) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          if (name && available.some((x) => x.name === name)) {
            setStore("current", name)
            return
          }
          setStore("current", first(available)?.name)
        },
        move(direction: 1 | -1) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          let next = available.findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = available.length - 1
          if (next >= available.length) next = 0
          const value = available[next]
          if (!value) return
          setStore("current", value.name)
          if (value.model && !strictGlobal())
            setModel({
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            })
        },
      }
    })()

    const model = (() => {
      const models = useModels()

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey | undefined>
      }>({
        model: {},
      })

      const configured = createMemo(() => sync.data.config.model)

      const resolveConfigured = () => {
        const key = parseConfigured(configured())
        if (!key) return
        if (isModelValid(key)) return key
      }

      const resolveRecent = () => {
        for (const item of models.recent.list()) {
          if (isModelValid(item)) return item
        }
      }

      const resolveDefault = () => {
        const defaults = providers.default()
        const connected = providers
          .connected()
          .map((item) => item.id)
          .sort((a, b) => a.localeCompare(b))
        const enabled = sync.data.config.enabled_providers ?? []
        const preferred = enabled.filter((id) => connected.includes(id))
        const rest = connected.filter((id) => !preferred.includes(id))
        for (const providerID of [...preferred, ...rest]) {
          const modelID = defaults[providerID]
          if (!modelID) continue
          const key = { providerID, modelID }
          if (isModelValid(key)) return key
        }
      }

      const fallbackModel = createMemo<ModelKey | undefined>(() => {
        if (strictGlobal()) return resolveConfigured()
        return resolveConfigured() ?? resolveRecent() ?? resolveDefault()
      })

      const configuredReady = createMemo(() => {
        const key = parseConfigured(configured())
        if (!key) return strictGlobal() ? false : providers.all().length > 0
        const provider = providers.all().find((x) => x.id === key.providerID)
        return !!provider?.models[key.modelID] && connected().has(key.providerID)
      })

      const current = createMemo(() => {
        const a = agent.current()
        if (!a) return undefined
        const key = strictGlobal()
          ? getFirstValidModel(resolveConfigured)
          : getFirstValidModel(() => ephemeral.model[a.name], () => a.model, fallbackModel)
        if (!key) return undefined
        return models.find(key)
      })

      const recent = createMemo(() => {
        if (strictGlobal()) return []
        return models.recent.list().map(models.find).filter(Boolean)
      })

      const cycle = (direction: 1 | -1) => {
        if (strictGlobal()) return
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      const set = (model: ModelKey | undefined, options?: { recent?: boolean }) => {
        if (strictGlobal()) return
        batch(() => {
          const currentAgent = agent.current()
          const next = model ?? fallbackModel()
          if (currentAgent) setEphemeral("model", currentAgent.name, next)
          if (model) models.setVisibility(model, true)
          if (options?.recent && model) models.recent.push(model)
        })
      }

      setModel = set

      return {
        ready: createMemo(() => models.ready() && configuredReady()),
        configured,
        current,
        recent,
        list: models.list,
        cycle,
        set,
        visible(model: ModelKey) {
          return models.visible(model)
        },
        setVisibility(model: ModelKey, visible: boolean) {
          models.setVisibility(model, visible)
        },
        variant: {
          configured() {
            const a = agent.current()
            const m = current()
            if (!a || !m) return undefined
            return getConfiguredAgentVariant({
              agent: { model: a.model, variant: a.variant },
              model: { providerID: m.provider.id, modelID: m.id, variants: m.variants },
            })
          },
          selected() {
            if (strictGlobal()) return undefined
            const m = current()
            if (!m) return undefined
            return models.variant.get({ providerID: m.provider.id, modelID: m.id })
          },
          current() {
            if (strictGlobal()) return undefined
            return resolveModelVariant({
              variants: this.list(),
              selected: this.selected(),
              configured: this.configured(),
            })
          },
          list() {
            const m = current()
            if (!m) return []
            if (!m.variants) return []
            return Object.keys(m.variants)
          },
          set(value: string | undefined) {
            if (strictGlobal()) return
            const m = current()
            if (!m) return
            models.variant.set({ providerID: m.provider.id, modelID: m.id }, value)
          },
          cycle() {
            if (strictGlobal()) return
            const variants = this.list()
            if (variants.length === 0) return
            this.set(
              cycleModelVariant({
                variants,
                selected: this.selected(),
                configured: this.configured(),
              }),
            )
          },
        },
      }
    })()

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
    }
    return result
  },
})
