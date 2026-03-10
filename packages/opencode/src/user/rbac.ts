import type { MiddlewareHandler } from "hono"

export namespace UserRbac {
  export function has(input: { permissions: string[]; code: string }) {
    return input.permissions.includes(input.code)
  }

  export function requireRole(code: string): MiddlewareHandler {
    return async (c, next) => {
      const roles = c.get("account_roles") as string[] | undefined
      if (!roles?.includes(code)) {
        return c.json(
          {
            error: "forbidden",
            role: code,
          },
          403,
        )
      }
      return next()
    }
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
