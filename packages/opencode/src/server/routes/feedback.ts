import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Flag } from "@/flag/flag"
import { FeedbackService } from "@/feedback/service"
import { UserRbac } from "@/user/rbac"
import { errors } from "../error"

const FeedbackStatus = z.enum(["open", "processing", "resolved"]).meta({ ref: "FeedbackStatus" })
const FeedbackSourcePlatform = z.enum(["pc_web", "mobile_web"]).meta({ ref: "FeedbackSourcePlatform" })

const FeedbackThread = z
  .object({
    id: z.string(),
    project_id: z.string(),
    product_id: z.string(),
    product_name: z.string(),
    page_name: z.string(),
    menu_path: z.string().optional(),
    source_platform: FeedbackSourcePlatform,
    user_id: z.string(),
    username: z.string(),
    display_name: z.string(),
    org_id: z.string(),
    department_id: z.string().optional(),
    title: z.string(),
    content: z.string(),
    status: FeedbackStatus,
    resolved_by: z.string().optional(),
    resolved_name: z.string().optional(),
    resolved_at: z.number().optional(),
    last_reply_at: z.number(),
    reply_count: z.number(),
    time_created: z.number(),
    time_updated: z.number(),
  })
  .meta({ ref: "FeedbackThread" })

const FeedbackPost = z
  .object({
    id: z.string(),
    thread_id: z.string(),
    user_id: z.string(),
    username: z.string(),
    display_name: z.string(),
    org_id: z.string(),
    department_id: z.string().optional(),
    content: z.string(),
    official_reply: z.boolean(),
    time_created: z.number(),
    time_updated: z.number(),
  })
  .meta({ ref: "FeedbackPost" })

const FeedbackDetail = z
  .object({
    ok: z.literal(true),
    thread: FeedbackThread,
    posts: z.array(FeedbackPost),
  })
  .meta({ ref: "FeedbackDetail" })

const FeedbackThreadCreateResult = z
  .object({
    ok: z.literal(true),
    thread: FeedbackThread,
  })
  .meta({ ref: "FeedbackThreadCreateResult" })

const FeedbackPostCreateResult = z
  .object({
    ok: z.literal(true),
    post: FeedbackPost,
  })
  .meta({ ref: "FeedbackPostCreateResult" })

const FeedbackThreadStatusResult = z
  .object({
    ok: z.literal(true),
    thread: FeedbackThread,
  })
  .meta({ ref: "FeedbackThreadStatusResult" })

function canView(permissions: string[]) {
  return permissions.some((item) =>
    ["feedback:create", "feedback:reply", "feedback:resolve", "feedback:manage"].includes(item),
  )
}

function actor(c: Context) {
  const user = c.get("account_user") as
    | {
        id: string
        username: string
        display_name: string
        org_id: string
        department_id?: string
      }
    | undefined
  const permissions = c.get("account_permissions") as string[] | undefined
  const context_project_id = c.get("account_context_project_id") as string | undefined
  if (!user || !permissions) return c.json({ error: "unauthorized" }, 401)
  if (!canView(permissions)) {
    return c.json(
      {
        error: "forbidden",
        permission: "feedback:create|feedback:reply|feedback:resolve|feedback:manage",
      },
      403,
    )
  }
  if (!context_project_id) return c.json({ error: "project_context_required" }, 400)
  return {
    user_id: user.id,
    username: user.username,
    display_name: user.display_name,
    org_id: user.org_id,
    department_id: user.department_id,
    permissions,
    context_project_id,
  }
}

export const FeedbackRoutes = lazy(() =>
  new Hono()
    .use(async (c, next) => {
      if (!Flag.TPCODE_ACCOUNT_ENABLED || !Flag.TPCODE_FEEDBACK_ENABLED) return c.json({ error: "feedback_disabled" }, 404)
      return next()
    })
    .get(
      "/threads",
      describeRoute({
        summary: "List feedback threads",
        description: "List feedback forum threads inside the current project context.",
        operationId: "feedback.list",
        responses: {
          200: {
            description: "Feedback thread list",
            content: {
              "application/json": {
                schema: resolver(z.array(FeedbackThread)),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator(
        "query",
        z.object({
          status: FeedbackStatus.optional(),
          mine: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const query = c.req.valid("query")
        return c.json(
          await FeedbackService.list({
            actor: current,
            status: query.status,
            mine: query.mine,
            limit: query.limit,
          }),
        )
      },
    )
    .get(
      "/threads/:thread_id",
      describeRoute({
        summary: "Get feedback thread detail",
        description: "Get one feedback thread and its replies inside the current project context.",
        operationId: "feedback.get",
        responses: {
          200: {
            description: "Feedback detail",
            content: {
              "application/json": {
                schema: resolver(FeedbackDetail),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator("param", z.object({ thread_id: z.string().min(1) })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const result = await FeedbackService.get({
          actor: current,
          thread_id: param.thread_id,
        })
        if (!result.ok) return c.json(result, 404)
        return c.json(result)
      },
    )
    .post(
      "/threads",
      UserRbac.require("feedback:create"),
      describeRoute({
        summary: "Create feedback thread",
        description: "Create a new feedback thread in the current project context.",
        operationId: "feedback.create",
        responses: {
          200: {
            description: "Create result",
            content: {
              "application/json": {
                schema: resolver(FeedbackThreadCreateResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator(
        "json",
        z.object({
          title: z.string().min(1),
          content: z.string().min(1),
          page_name: z.string().optional(),
          menu_path: z.string().optional(),
          source_platform: FeedbackSourcePlatform,
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const body = c.req.valid("json")
        const result = await FeedbackService.create({
          actor: current,
          title: body.title,
          content: body.content,
          page_name: body.page_name,
          menu_path: body.menu_path,
          source_platform: body.source_platform,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .post(
      "/threads/:thread_id/posts",
      UserRbac.require("feedback:reply"),
      describeRoute({
        summary: "Reply feedback thread",
        description: "Reply to an existing feedback thread in the current project context.",
        operationId: "feedback.reply",
        responses: {
          200: {
            description: "Reply result",
            content: {
              "application/json": {
                schema: resolver(FeedbackPostCreateResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator("param", z.object({ thread_id: z.string().min(1) })),
      validator(
        "json",
        z.object({
          content: z.string().min(1),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await FeedbackService.reply({
          actor: current,
          thread_id: param.thread_id,
          content: body.content,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "thread_missing") return c.json(result, 404)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .patch(
      "/threads/:thread_id/status",
      UserRbac.require("feedback:resolve"),
      describeRoute({
        summary: "Update feedback status",
        description: "Update an existing feedback thread status inside the current project context.",
        operationId: "feedback.updateStatus",
        responses: {
          200: {
            description: "Update result",
            content: {
              "application/json": {
                schema: resolver(FeedbackThreadStatusResult),
              },
            },
          },
          ...errors(400, 403, 404),
        },
      }),
      validator("param", z.object({ thread_id: z.string().min(1) })),
      validator(
        "json",
        z.object({
          status: FeedbackStatus,
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await FeedbackService.updateStatus({
          actor: current,
          thread_id: param.thread_id,
          status: body.status,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 404)
        return c.json(result)
      },
    ),
)
