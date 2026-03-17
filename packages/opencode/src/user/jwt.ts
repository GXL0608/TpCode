import { sign, verify } from "hono/jwt"
import z from "zod"
import { Flag } from "@/flag/flag"

const AccessPayload = z.object({
  sub: z.string(),
  typ: z.literal("access"),
  sid: z.string(),
  pid: z.string().optional(),
  prid: z.string().optional(),
  exp: z.number(),
  iat: z.number(),
})

const RefreshPayload = z.object({
  sub: z.string(),
  typ: z.literal("refresh"),
  sid: z.string(),
  pid: z.string().optional(),
  prid: z.string().optional(),
  exp: z.number(),
  iat: z.number(),
})

function secret() {
  return Flag.TPCODE_ACCOUNT_JWT_SECRET ?? Flag.OPENCODE_SERVER_PASSWORD ?? "tpcode-account-dev-secret"
}

function now() {
  return Math.floor(Date.now() / 1000)
}

export namespace UserJwt {
  /** 中文注释：签发访问令牌时同时携带项目与产品上下文，兼容新旧两套上下文链路。 */
  export async function issueAccess(input: { user_id: string; session_id: string; context_project_id?: string; context_product_id?: string; ttl?: number }) {
    const iat = now()
    const exp = iat + (input.ttl ?? 2 * 60 * 60)
    const token = await sign(
      {
        sub: input.user_id,
        sid: input.session_id,
        pid: input.context_project_id,
        prid: input.context_product_id,
        typ: "access",
        iat,
        exp,
      },
      secret(),
    )
    return { token, exp: exp * 1000 }
  }

  /** 中文注释：签发刷新令牌时保留产品上下文，确保刷新后无需重新选择产品。 */
  export async function issueRefresh(input: { user_id: string; session_id: string; context_project_id?: string; context_product_id?: string; ttl?: number }) {
    const iat = now()
    const exp = iat + (input.ttl ?? 14 * 24 * 60 * 60)
    const token = await sign(
      {
        sub: input.user_id,
        sid: input.session_id,
        pid: input.context_project_id,
        prid: input.context_product_id,
        typ: "refresh",
        iat,
        exp,
      },
      secret(),
    )
    return { token, exp: exp * 1000 }
  }

  export async function verifyAccess(token: string) {
    try {
      const payload = await verify(token, secret())
      const parsed = AccessPayload.safeParse(payload)
      if (!parsed.success) return
      return parsed.data
    } catch {
      return
    }
  }

  export async function verifyRefresh(token: string) {
    try {
      const payload = await verify(token, secret())
      const parsed = RefreshPayload.safeParse(payload)
      if (!parsed.success) return
      return parsed.data
    } catch {
      return
    }
  }
}
