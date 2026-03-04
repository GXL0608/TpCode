import { Context } from "@/util/context"

const ctx = Context.create<{
  user_id: string
  org_id: string
  department_id?: string
  context_project_id?: string
  roles: string[]
  permissions: string[]
}>("account")

export namespace AccountCurrent {
  export function provide<R>(
    input: {
      user_id: string
      org_id: string
      department_id?: string
      context_project_id?: string
      roles: string[]
      permissions: string[]
    },
    fn: () => R,
  ) {
    return ctx.provide(input, fn)
  }

  export function use() {
    return ctx.use()
  }

  export function optional() {
    try {
      return ctx.use()
    } catch {
      return
    }
  }
}
