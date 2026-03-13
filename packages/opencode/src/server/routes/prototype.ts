import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { errors } from "../error"
import z from "zod"
import { lazy } from "@/util/lazy"
import { PrototypeDeleteResult, PrototypeDetailResult, PrototypeVariant } from "@/prototype/schema"
import { PrototypeService } from "@/prototype/service"

function requirePermission(c: Context, code: string) {
  const permissions = c.get("account_permissions") as string[] | undefined
  if (!permissions) return
  if (permissions.includes(code)) return
  return c.json(
    {
      error: "forbidden",
      permission: code,
    },
    403,
  )
}

export const PrototypeRoutes = lazy(() =>
  new Hono()
    .get(
      "/:prototypeID",
      describeRoute({
        summary: "Get prototype detail",
        description: "Get one prototype asset by ID.",
        operationId: "prototype.get",
        responses: {
          200: {
            description: "Prototype detail",
            content: {
              "application/json": {
                schema: resolver(PrototypeDetailResult),
              },
            },
          },
          ...errors(403, 404),
        },
      }),
      validator("param", z.object({ prototypeID: z.string() })),
      async (c) => {
        const denied = requirePermission(c, "prototype:view")
        if (denied) return denied
        const prototype = await PrototypeService.getByID(c.req.valid("param").prototypeID)
        if (!prototype) return c.json({ error: "prototype_missing" }, 404)
        return c.json({
          ok: true,
          prototype,
        })
      },
    )
    .get(
      "/:prototypeID/file",
      describeRoute({
        summary: "Get prototype file",
        description: "Read the prototype image bytes.",
        operationId: "prototype.file",
        responses: {
          200: {
            description: "Prototype file",
          },
          ...errors(403, 404),
        },
      }),
      validator(
        "query",
        z.object({
          variant: PrototypeVariant.optional(),
          access_token: z.string().optional(),
        }),
      ),
      validator("param", z.object({ prototypeID: z.string() })),
      async (c) => {
        const denied = requirePermission(c, "prototype:view")
        if (denied) return denied
        const result = await PrototypeService.file(c.req.valid("param").prototypeID)
        if (!result) return c.json({ error: "prototype_missing" }, 404)
        c.header("Content-Type", result.mime)
        c.header("Content-Length", String(result.size_bytes))
        c.header("Cache-Control", "private, max-age=60")
        return c.body(new Uint8Array(await result.file.bytes()))
      },
    )
    .delete(
      "/:prototypeID",
      describeRoute({
        summary: "Delete prototype",
        description: "Delete one prototype asset by ID.",
        operationId: "prototype.delete",
        responses: {
          200: {
            description: "Prototype deleted",
            content: {
              "application/json": {
                schema: resolver(PrototypeDeleteResult),
              },
            },
          },
          ...errors(403, 404),
        },
      }),
      validator("param", z.object({ prototypeID: z.string() })),
      async (c) => {
        const denied = requirePermission(c, "code:generate")
        if (denied) return denied
        const result = await PrototypeService.remove({ id: c.req.valid("param").prototypeID })
        if (!result.ok) return c.json(result, 404)
        return c.json(result)
      },
    ),
)
