import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Flag } from "@/flag/flag"
import { Database, eq } from "@/storage/db"
import { TpProductTable } from "@/user/product.sql"
import { ProductSolutionService } from "@/user/product-solution"

/** 中文注释：校验当前请求是否可以访问指定产品；管理权限放行，其余账号仅允许访问当前上下文产品。 */
async function requireProductAccess(c: Context, product_id: string) {
  const product = await Database.use((db) => db.select().from(TpProductTable).where(eq(TpProductTable.id, product_id)).get())
  if (!product) {
    return {
      ok: false as const,
      response: c.json(
        {
          error: "product_missing",
          code: "product_missing",
        },
        404,
      ),
    }
  }
  if (!Flag.TPCODE_ACCOUNT_ENABLED) return { ok: true as const, product }
  const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
  const context_product_id = c.get("account_context_product_id" as never) as string | undefined
  if (permissions.includes("role:manage") || product.id === context_product_id) {
    return { ok: true as const, product }
  }
  return {
    ok: false as const,
    response: c.json(
      {
        error: "forbidden",
        permission: "product:access",
      },
      403,
    ),
  }
}

export const ProductRoutes = lazy(() =>
  new Hono().get(
    "/:product_id/solution",
    describeRoute({
      summary: "List product solutions",
      description: "List enabled and disabled build solutions under the current product.",
      operationId: "product.solution.list",
      responses: {
        200: {
          description: "Product solutions",
          content: {
            "application/json": {
              schema: resolver(z.array(z.record(z.string(), z.unknown()))),
            },
          },
        },
      },
    }),
    validator("param", z.object({ product_id: z.string().min(1) })),
    async (c) => {
      const param = c.req.valid("param")
      const access = await requireProductAccess(c, param.product_id)
      if (!access.ok) return access.response
      return c.json(await ProductSolutionService.list(param.product_id))
    },
  ),
)
