import type { MiddlewareHandler } from "hono"

export namespace UserRbac {
  export function has(input: { permissions: string[]; code: string }) {
    return input.permissions.includes(input.code)
  }

  export function require(code: string): MiddlewareHandler {
    return async (c, next) => {
      const permissions = c.get("account_permissions") as string[] | undefined
      if (!permissions?.includes(code)) {
        return c.json(
          {
            error: "forbidden",
            permission: code,
          },
          403,
        )
      }
      return next()
    }
  }
}
