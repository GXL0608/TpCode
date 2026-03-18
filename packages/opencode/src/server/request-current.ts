import { Context } from "@/util/context"

const ctx = Context.create<{
  ip?: string
  user_agent?: string
  terminal_type?: "PC" | "移动端"
}>("request")

export namespace RequestCurrent {
  export function provide<R>(
    input: {
      ip?: string
      user_agent?: string
      terminal_type?: "PC" | "移动端"
    },
    fn: () => R,
  ) {
    return ctx.provide(input, fn)
  }

  export function optional() {
    try {
      return ctx.use()
    } catch {
      return
    }
  }
}
