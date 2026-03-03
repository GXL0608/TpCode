import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Flag } from "@/flag/flag"
import { UserRbac } from "@/user/rbac"
import { ApprovalService } from "@/approval/service"
import { errors } from "../error"

function actor(c: Context) {
  const user_id = c.get("account_user_id") as string | undefined
  const org_id = c.get("account_org_id") as string | undefined
  const department_id = c.get("account_department_id") as string | undefined
  const permissions = c.get("account_permissions") as string[] | undefined
  if (!user_id || !org_id || !permissions) return c.json({ error: "unauthorized" }, 401)
  return {
    user_id,
    org_id,
    department_id,
    permissions,
  }
}

export const ApprovalRoutes = lazy(() =>
  new Hono()
    .use(async (c, next) => {
      if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json({ error: "account_disabled" }, 404)
      return next()
    })
    .get(
      "/reviewer",
      describeRoute({
        summary: "List reviewers",
        description: "List candidates that can be selected as reviewers when submitting approval.",
        operationId: "approval.reviewer.list",
        responses: {
          200: {
            description: "Reviewers",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      username: z.string(),
                      display_name: z.string(),
                      org_id: z.string(),
                      department_id: z.string().optional(),
                      roles: z.array(z.string()),
                      permissions: z.array(z.string()),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        return c.json(await ApprovalService.listReviewer({ actor: current }))
      },
    )
    .get(
      "/change-request",
      describeRoute({
        summary: "List change requests",
        description: "List approval change requests with scope isolation.",
        operationId: "approval.change_request.list",
        responses: {
          200: {
            description: "Change request list",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.unknown()))),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          status: z.string().optional(),
          mine: z.coerce.boolean().optional(),
          reviewer_only: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const query = c.req.valid("query")
        return c.json(
          await ApprovalService.listChange({
            actor: current,
            status: query.status,
            mine: query.mine,
            reviewer_only: query.reviewer_only,
            limit: query.limit,
          }),
        )
      },
    )
    .post(
      "/change-request",
      UserRbac.require("session:create"),
      describeRoute({
        summary: "Create change request",
        description: "Create a draft approval change request.",
        operationId: "approval.change_request.create",
        responses: {
          200: {
            description: "Create result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), id: z.string().optional(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          page_id: z.string().optional(),
          session_id: z.string().optional(),
          title: z.string().min(1),
          description: z.string().min(1),
          ai_plan: z.string().optional(),
          ai_prototype_url: z.string().optional(),
          ai_score: z.number().int().min(0).max(100).optional(),
          ai_revenue_assessment: z.string().optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const body = c.req.valid("json")
        const result = await ApprovalService.create({
          actor: current,
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) return c.json(result, 400)
        return c.json(result)
      },
    )
    .get(
      "/change-request/:change_request_id",
      describeRoute({
        summary: "Get change request detail",
        description: "Get change request with approvals and timeline.",
        operationId: "approval.change_request.get",
        responses: {
          200: {
            description: "Change request detail",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.unknown())),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const result = await ApprovalService.getChange({
          actor: current,
          change_request_id: param.change_request_id,
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 404)
        }
        return c.json(result)
      },
    )
    .patch(
      "/change-request/:change_request_id",
      describeRoute({
        summary: "Update change request",
        description: "Update draft/rejected/confirmed change request fields.",
        operationId: "approval.change_request.update",
        responses: {
          200: {
            description: "Update result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          ai_plan: z.string().optional(),
          ai_prototype_url: z.string().optional(),
          ai_score: z.number().int().min(0).max(100).optional(),
          ai_revenue_assessment: z.string().optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await ApprovalService.update({
          actor: current,
          change_request_id: param.change_request_id,
          ...body,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .post(
      "/change-request/:change_request_id/confirm",
      describeRoute({
        summary: "Confirm prototype",
        description: "Confirm prototype before submit review.",
        operationId: "approval.change_request.confirm",
        responses: {
          200: {
            description: "Confirm result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const result = await ApprovalService.confirm({
          actor: current,
          change_request_id: param.change_request_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .post(
      "/change-request/:change_request_id/submit",
      describeRoute({
        summary: "Submit approval",
        description: "Submit change request with ordered reviewer list.",
        operationId: "approval.change_request.submit",
        responses: {
          200: {
            description: "Submit result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    status: z.string().optional(),
                    current_step: z.number().optional(),
                    code: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      validator(
        "json",
        z.object({
          reviewer_ids: z.array(z.string()).optional(),
          ai_score: z.number().int().min(0).max(100).optional(),
          ai_revenue_assessment: z.string().optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await ApprovalService.submit({
          actor: current,
          change_request_id: param.change_request_id,
          reviewer_ids: body.reviewer_ids,
          ai_score: body.ai_score,
          ai_revenue_assessment: body.ai_revenue_assessment,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .post(
      "/change-request/:change_request_id/executing",
      UserRbac.require("code:generate"),
      describeRoute({
        summary: "Mark executing",
        description: "Mark approved request as executing.",
        operationId: "approval.change_request.executing",
        responses: {
          200: {
            description: "Update result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const result = await ApprovalService.executing({
          actor: current,
          change_request_id: param.change_request_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .post(
      "/change-request/:change_request_id/completed",
      UserRbac.require("code:deploy"),
      describeRoute({
        summary: "Mark completed",
        description: "Mark executing request as completed.",
        operationId: "approval.change_request.completed",
        responses: {
          200: {
            description: "Update result",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), code: z.string().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ change_request_id: z.string() })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const result = await ApprovalService.completed({
          actor: current,
          change_request_id: param.change_request_id,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .get(
      "/review",
      describeRoute({
        summary: "List reviews",
        description: "List approval review tasks.",
        operationId: "approval.review.list",
        responses: {
          200: {
            description: "Review tasks",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.unknown()))),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
          mine: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const query = c.req.valid("query")
        return c.json(
          await ApprovalService.listReview({
            actor: current,
            status: query.status,
            mine: query.mine,
            limit: query.limit,
          }),
        )
      },
    )
    .post(
      "/review/:approval_id/approve",
      describeRoute({
        summary: "Approve review",
        description: "Approve one review step.",
        operationId: "approval.review.approve",
        responses: {
          200: {
            description: "Approve result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    status: z.string().optional(),
                    current_step: z.number().optional(),
                    code: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ approval_id: z.string() })),
      validator("json", z.object({ comment: z.string().optional() })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await ApprovalService.review({
          actor: current,
          approval_id: param.approval_id,
          action: "approved",
          comment: body.comment,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    )
    .post(
      "/review/:approval_id/reject",
      describeRoute({
        summary: "Reject review",
        description: "Reject one review step.",
        operationId: "approval.review.reject",
        responses: {
          200: {
            description: "Reject result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    status: z.string().optional(),
                    current_step: z.number().optional(),
                    code: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ approval_id: z.string() })),
      validator("json", z.object({ comment: z.string().min(1) })),
      async (c) => {
        const current = actor(c)
        if ("status" in current) return current
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await ApprovalService.review({
          actor: current,
          approval_id: param.approval_id,
          action: "rejected",
          comment: body.comment,
          ip: c.req.header("x-forwarded-for"),
          user_agent: c.req.header("user-agent"),
        })
        if (!result.ok) {
          if (result.code === "forbidden") return c.json(result, 403)
          return c.json(result, 400)
        }
        return c.json(result)
      },
    ),
)
