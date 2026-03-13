import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { errors } from "../error"
import z from "zod"
import { lazy } from "@/util/lazy"
import {
  PrototypeCaptureInput,
  PrototypeListResult,
  PrototypeSaveResult,
  PrototypeUploadInput,
} from "@/prototype/schema"
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

function actor(c: Context) {
  const user_id = c.get("account_user_id" as never) as string | undefined
  const org_id = c.get("account_org_id" as never) as string | undefined
  const department_id = c.get("account_department_id" as never) as string | undefined
  return {
    user_id,
    org_id,
    department_id,
  }
}

export const SessionPrototypeRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List session prototypes",
        description: "List prototype assets inside a session.",
        operationId: "session.prototypeList",
        responses: {
          200: {
            description: "Prototype list",
            content: {
              "application/json": {
                schema: resolver(PrototypeListResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator(
        "query",
        z.object({
          page_key: z.string().optional(),
          latest: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const denied = requirePermission(c, "prototype:view")
        if (denied) return denied
        const sessionID = c.req.param("sessionID")
        if (!sessionID) return c.json({ error: "session_missing" }, 400)
        const query = c.req.valid("query")
        const items = await PrototypeService.listBySession({
          session_id: sessionID,
          page_key: query.page_key,
          latest: query.latest,
          limit: query.limit,
        })
        return c.json({ items })
      },
    )
    .post(
      "/upload",
      describeRoute({
        summary: "Upload session prototype",
        description: "Save a manually uploaded prototype image into the current session.",
        operationId: "session.prototypeUpload",
        responses: {
          200: {
            description: "Saved prototype",
            content: {
              "application/json": {
                schema: resolver(PrototypeSaveResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator("json", PrototypeUploadInput),
      async (c) => {
        const denied = requirePermission(c, "code:generate")
        if (denied) return denied
        const sessionID = c.req.param("sessionID")
        if (!sessionID) return c.json({ error: "session_missing" }, 400)
        const body = c.req.valid("json")
        const result = await PrototypeService.upload({
          actor: actor(c),
          session_id: body.saved_plan_id?.trim() || sessionID,
          agent_mode: body.agent_mode,
          message_id: body.message_id,
          title: body.title,
          description: body.description,
          route: body.route,
          page_key: body.page_key,
          filename: body.filename,
          content_type: body.content_type,
          data_base64: body.data_base64,
          source_url: body.source_url,
          viewport: body.viewport,
          test_run_id: body.test_run_id,
          test_result: body.test_result,
        })
        if (!result.ok) return c.json(result, result.code === "prototype_invalid_mode" ? 400 : 404)
        return c.json(result)
      },
    )
    .post(
      "/capture",
      describeRoute({
        summary: "Capture session prototype",
        description: "Capture a page screenshot and store it as a prototype asset.",
        operationId: "session.prototypeCapture",
        responses: {
          200: {
            description: "Saved prototype",
            content: {
              "application/json": {
                schema: resolver(PrototypeSaveResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator("json", PrototypeCaptureInput),
      async (c) => {
        const denied = requirePermission(c, "code:generate")
        if (denied) return denied
        const sessionID = c.req.param("sessionID")
        if (!sessionID) return c.json({ error: "session_missing" }, 400)
        const body = c.req.valid("json")
        const result = await PrototypeService.capture({
          actor: actor(c),
          session_id: body.saved_plan_id?.trim() || sessionID,
          agent_mode: body.agent_mode,
          message_id: body.message_id,
          title: body.title,
          description: body.description,
          route: body.route,
          page_key: body.page_key,
          source_url: body.source_url,
          wait_until: body.wait_until,
          ready_selector: body.ready_selector,
          delay_ms: body.delay_ms,
          viewport: body.viewport,
          test_run_id: body.test_run_id,
          test_result: body.test_result,
        })
        if (!result.ok) return c.json(result, result.code === "prototype_invalid_mode" ? 400 : 404)
        return c.json(result)
      },
    ),
)
