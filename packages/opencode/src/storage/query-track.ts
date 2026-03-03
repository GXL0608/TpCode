import { Context } from "@/util/context"

type State = {
  pending: Promise<unknown>[]
}

const ctx = Context.create<State>("db-query-track")

async function drain(state: State) {
  while (state.pending.length > 0) {
    const list = state.pending.splice(0)
    await Promise.all(list)
  }
}

export namespace QueryTrack {
  export function track<T>(promise: Promise<T>) {
    try {
      ctx.use().pending.push(promise)
    } catch {}
    return promise
  }

  export async function scoped<T>(fn: () => Promise<T> | T): Promise<T> {
    const state: State = { pending: [] }
    const value = await ctx.provide(state, fn)
    await drain(state)
    return value
  }
}
