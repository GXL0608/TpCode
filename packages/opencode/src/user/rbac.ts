import type { MiddlewareHandler } from "hono"

export namespace UserRbac {
  /** 中文注释：统一判断当前账号是否具备 Build 相关能力，超级管理员默认具备该能力。 */
  export function canUseBuild(input: { roles?: string[]; permissions?: string[] }) {
    if (input.roles?.includes("super_admin")) return true
    return !!input.permissions?.includes("agent:use_build")
  }

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
