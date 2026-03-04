import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Flag } from "@/flag/flag"
import { AccountContextService } from "@/user/context"

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with TpCode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json(projects)
        const user_id = c.get("account_user_id" as never) as string | undefined
        if (!user_id) return c.json(projects)
        const ids = await AccountContextService.projectIDs(user_id)
        return c.json(projects.filter((item) => ids.includes(item.id)))
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that TpCode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json(Instance.project)
        const context_project_id = c.get("account_context_project_id" as never) as string | undefined
        if (!context_project_id) return c.json({ error: "project_context_required" }, 428)
        const project = await Project.get(context_project_id)
        if (!project) return c.json({ error: "project_missing" }, 404)
        return c.json(project)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        if (Flag.TPCODE_ACCOUNT_ENABLED) {
          const context_project_id = c.get("account_context_project_id" as never) as string | undefined
          if (!context_project_id) return c.json({ error: "project_context_required" }, 428)
          if (projectID !== context_project_id) return c.json({ error: "project_context_mismatch" }, 403)
        }
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    ),
)
