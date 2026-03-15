import { Hono, type Context } from "hono"
import path from "path"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { BuildJobService } from "@/build/service"
import { AccountProductService } from "@/user/product"
import { UserRbac } from "@/user/rbac"
import { Session } from "@/session"
import { Workspace } from "@/control-plane/workspace"
import type { BunFile } from "bun"

const BuildJobCreateBody = z.object({
  source_type: z.enum(["prompt", "saved_plan"]).default("prompt"),
  product_id: z.string().optional(),
  solution_id: z.string().optional(),
  prompt_text: z.string().optional(),
  saved_plan_id: z.string().optional(),
  run_mode: z.enum(["async", "sync"]).optional(),
})

const BuildJobBatchBody = z.object({
  product_id: z.string().min(1).optional(),
  solution_id: z.string().optional(),
  saved_plan_ids: z.array(z.string().min(1)).min(1),
  run_mode: z.enum(["async", "sync"]).optional(),
})

/** 中文注释：统一校验 Build 能力，保证用户态与管理态都经过同一套权限门槛。 */
function requireBuild(c: Context) {
  const roles = (c.get("account_roles" as never) as string[] | undefined) ?? []
  const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
  if (UserRbac.canUseBuild({ roles, permissions }) || permissions.includes("role:manage")) return
  return c.json(
    {
      error: "forbidden",
      permission: "agent:use_build",
    },
    403,
  )
}

/** 中文注释：根据当前上下文项目回填产品标识，避免 build 模式提交时前端必须重复携带产品 ID。 */
async function resolveProductID(c: Context, product_id?: string) {
  const explicit = product_id?.trim()
  if (explicit) return explicit
  const context_project_id = c.get("account_context_project_id" as never) as string | undefined
  if (!context_project_id) return
  const items = await AccountProductService.listByProjectIDs([context_project_id])
  return items.find((item) => item.project_id === context_project_id)?.id
}

/** 中文注释：为 build job 详情补充 session/workspace 目录信息，方便前端直接跳转和下载。 */
async function detailPayload(job_id: string) {
  const detail = await BuildJobService.get(job_id)
  if (!detail) return
  const session = detail.job.session_id ? await Session.get(detail.job.session_id).catch(() => undefined) : undefined
  const workspace = detail.job.workspace_id ? await Workspace.get(detail.job.workspace_id).catch(() => undefined) : undefined
  return {
    ...detail,
    session_directory: session?.directory,
    workspace_directory: workspace?.directory,
  }
}

/** 中文注释：在异步模式下后台启动单个构建任务，避免阻塞请求生命周期。 */
function runLater(job_id: string) {
  void BuildJobService.run(job_id).catch(() => undefined)
}

/** 中文注释：把压缩包文件包装为下载响应，统一处理文件名和内容类型。 */
function download(file: BunFile, filename: string) {
  return new Response(file, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}

export const BuildRoutes = lazy(() =>
  new Hono()
    .get(
      "/job",
      describeRoute({
        summary: "List build jobs",
        description: "List build jobs for current product or management console.",
        operationId: "build.job.list",
        responses: {
          200: {
            description: "Build jobs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.unknown()))),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          product_id: z.string().optional(),
          solution_id: z.string().optional(),
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const query = c.req.valid("query")
        const product_id = await resolveProductID(c, query.product_id)
        return c.json(
          await BuildJobService.list({
            product_id,
            solution_id: query.solution_id,
            status: query.status,
            limit: query.limit,
          }),
        )
      },
    )
    .post(
      "/job",
      describeRoute({
        summary: "Create build job",
        description: "Create a build job and optionally execute it immediately.",
        operationId: "build.job.create",
        responses: {
          200: {
            description: "Build job created",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.unknown())),
              },
            },
          },
        },
      }),
      validator("json", BuildJobCreateBody),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const body = c.req.valid("json")
        const product_id = await resolveProductID(c, body.product_id)
        if (!product_id) {
          return c.json(
            {
              ok: false,
              code: "product_missing",
            },
            400,
          )
        }
        const created = await BuildJobService.create({
          source_type: body.source_type,
          product_id,
          solution_id: body.solution_id,
          prompt_text: body.prompt_text,
          saved_plan_id: body.saved_plan_id,
        })
        if (!created.ok) return c.json(created, 400)
        if (body.run_mode === "sync") {
          const executed = await BuildJobService.run(created.job.id)
          if (!executed.ok) return c.json(executed, 400)
          return c.json({
            ok: true as const,
            job: created.job,
            detail: await detailPayload(created.job.id),
          })
        }
        runLater(created.job.id)
        return c.json({
          ok: true as const,
          job: created.job,
        })
      },
    )
    .post(
      "/job/batch",
      describeRoute({
        summary: "Create build jobs in batch",
        description: "Create multiple build jobs from saved plans and optionally execute them.",
        operationId: "build.job.batch",
        responses: {
          200: {
            description: "Build jobs created",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.unknown())),
              },
            },
          },
        },
      }),
      validator("json", BuildJobBatchBody),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const body = c.req.valid("json")
        const product_id = await resolveProductID(c, body.product_id)
        if (!product_id) {
          return c.json(
            {
              ok: false,
              code: "product_missing",
            },
            400,
          )
        }
        const created = await BuildJobService.createBatch({
          product_id,
          solution_id: body.solution_id,
          saved_plan_ids: body.saved_plan_ids,
        })
        if (!created.ok) return c.json(created, 400)
        if (body.run_mode === "sync") {
          for (const item of created.jobs) {
            const executed = await BuildJobService.run(item.id)
            if (!executed.ok) return c.json(executed, 400)
          }
          const jobs = await Promise.all(created.jobs.map(async (item) => (await BuildJobService.get(item.id))?.job ?? item))
          return c.json({
            ok: true as const,
            jobs,
          })
        } else {
          created.jobs.forEach((item) => runLater(item.id))
        }
        return c.json({
          ok: true as const,
          jobs: created.jobs,
        })
      },
    )
    .get(
      "/job/:job_id",
      describeRoute({
        summary: "Get build job detail",
        description: "Get detail of a build job, including stages and artifacts.",
        operationId: "build.job.get",
        responses: {
          200: {
            description: "Build job detail",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.unknown())),
              },
            },
          },
        },
      }),
      validator("param", z.object({ job_id: z.string().min(1) })),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const detail = await detailPayload(param.job_id)
        if (!detail) return c.json({ ok: false, code: "build_job_missing" }, 404)
        return c.json(detail)
      },
    )
    .get(
      "/job/:job_id/artifact",
      describeRoute({
        summary: "List build artifacts",
        description: "List packaged artifacts under a build job.",
        operationId: "build.job.artifact.list",
        responses: {
          200: {
            description: "Build artifacts",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.unknown()))),
              },
            },
          },
        },
      }),
      validator("param", z.object({ job_id: z.string().min(1) })),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const detail = await BuildJobService.get(param.job_id)
        if (!detail) return c.json({ ok: false, code: "build_job_missing" }, 404)
        return c.json(detail.artifacts)
      },
    )
    .get(
      "/artifact/:artifact_id/file",
      describeRoute({
        summary: "Download artifact file",
        description: "Download a packaged zip artifact generated by a build job.",
        operationId: "build.artifact.file",
        responses: {
          200: {
            description: "Artifact file",
          },
        },
      }),
      validator("param", z.object({ artifact_id: z.string().min(1) })),
      async (c) => {
        const denied = requireBuild(c)
        if (denied) return denied
        const param = c.req.valid("param")
        const artifact = await BuildJobService.artifact(param.artifact_id)
        if (!artifact) return c.json({ ok: false, code: "build_artifact_missing" }, 404)
        const file = Bun.file(artifact.file_path)
        if (!(await file.exists())) return c.json({ ok: false, code: "build_artifact_missing" }, 404)
        return download(file, path.basename(artifact.file_name))
      },
    ),
)
