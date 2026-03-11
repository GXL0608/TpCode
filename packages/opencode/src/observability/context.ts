import { Context } from "../util/context"

type Fields = Record<string, unknown>

export namespace ObserveContext {
  const store = Context.create<Fields>("observability")

  export function current() {
    try {
      return store.use()
    } catch {
      return {}
    }
  }

  export function provide<T>(value: Fields, fn: () => T) {
    return store.provide(
      {
        ...current(),
        ...value,
      },
      fn,
    )
  }
}
