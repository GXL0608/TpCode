import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import fs from "fs"
import path from "path"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { ApprovalRoutes } from "./routes/approval"
import { MDNS } from "./mdns"
import { AccountRoutes } from "./routes/account"
import { UserService } from "@/user/service"
import { AccountCurrent } from "@/user/current"
import {
  createEventVisibilityCache,
  eventSessionID,
  eventVisibleToUser,
  warmEventVisibilityCache,
} from "./event-visibility"
import { AccountContextService } from "@/user/context"
import { Project } from "@/project/project"
import { Filesystem } from "@/util/filesystem"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })
  const webCsp =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

  let _url: URL | undefined
  let _corsWhitelist: string[] = []
  let _webRoot: string | undefined
  let _webResolved = false

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  const app = new Hono()
  let accountSeeded = false
  const CONTEXT_CACHE_TTL_MS = 300_000
  const contextProjectCache = new Map<
    string,
    {
      expires_at: number
      project: Project.Info | undefined
      worktree_ready: boolean
    }
  >()

  function clearContextProject(project_id?: string) {
    if (!project_id) {
      contextProjectCache.clear()
      return
    }
    contextProjectCache.delete(project_id)
  }

  async function contextProject(project_id: string) {
    if (Flag.TPCODE_CONTEXT_CACHE) {
      const cached = contextProjectCache.get(project_id)
      if (cached && cached.expires_at > Date.now()) return cached
      if (cached) contextProjectCache.delete(project_id)
    }
    const project = await Project.get(project_id)
    const worktree_ready = !!project && (await Filesystem.isDir(project.worktree))
    const next = {
      expires_at: Date.now() + CONTEXT_CACHE_TTL_MS,
      project,
      worktree_ready,
    }
    if (Flag.TPCODE_CONTEXT_CACHE) {
      contextProjectCache.set(project_id, next)
    }
    return next
  }

  function decodeDirectory(input: string) {
    try {
      return decodeURIComponent(input)
    } catch {
      return input
    }
  }

  function lightInstancePath(pathname: string) {
    if (!Flag.TPCODE_LIGHT_INSTANCE_ROUTES) return false
    if (!Flag.TPCODE_ACCOUNT_ENABLED) return false
    if (pathname === "/project" || pathname.startsWith("/project/")) return true
    if (pathname === "/global" || pathname.startsWith("/global/")) return true
    return false
  }

  function webRoots() {
    const roots = [
      process.env["OPENCODE_WEB_DIST"],
      path.resolve(process.cwd(), "packages/app/dist"),
      path.resolve(import.meta.dirname, "../../../app/dist"),
      path.resolve(path.dirname(process.execPath), "../web"),
      path.resolve(path.dirname(process.execPath), "../app-dist"),
    ]
    return roots.filter((item): item is string => !!item)
  }

  function webRoot() {
    if (_webResolved) return _webRoot
    _webResolved = true
    _webRoot = webRoots().find((item) => fs.existsSync(path.join(item, "index.html")))
    if (_webRoot) {
      log.info("web ui using local assets", { root: _webRoot })
      return _webRoot
    }
    if (Flag.OPENCODE_WEB_ALLOW_REMOTE_PROXY) {
      const payload = {
        target: "https://app.opencode.ai",
        roots: webRoots(),
      }
      if (process.env.NODE_ENV === "production") {
        log.warn("web ui local dist missing; using remote proxy", payload)
      } else {
        log.info("web ui local dist missing; using remote proxy", payload)
      }
      return
    }
    log.error("web ui local dist missing and remote proxy disabled", {
      roots: webRoots(),
      env: "OPENCODE_WEB_ALLOW_REMOTE_PROXY=false",
    })
    return
  }

  function webFile(root: string, input: string) {
    const normalized = path.posix.normalize(input.replace(/^\/+/, ""))
    if (normalized.startsWith("..")) return
    return path.join(root, normalized)
  }

  async function webLocal(pathname: string) {
    const root = webRoot()
    if (!root) return
    const request = pathname === "/" ? "index.html" : pathname
    const asset = webFile(root, request)
    if (asset) {
      const file = Bun.file(asset)
      if (await file.exists()) return new Response(file)
    }

    const input = request.replace(/^\/+/, "")
    if (input && path.extname(input)) return

    const index = webFile(root, "index.html")
    if (!index) return
    const file = Bun.file(index)
    if (!(await file.exists())) return
    return new Response(file)
  }

  export const App: () => Hono = lazy(
    () =>
      // TODO: Break server.ts into smaller route files to fix type inference
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use(
          cors({
            origin(input) {
              if (!input) return

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (
                input === "tauri://localhost" ||
                input === "http://tauri.localhost" ||
                input === "https://tauri.localhost"
              )
                return input

              // *.opencode.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .use((c, next) => {
          if (c.req.method === "OPTIONS") return next()
          if (Flag.TPCODE_ACCOUNT_ENABLED) {
            const path = c.req.path
            const publicPaths = [
              "/account/login",
              "/account/register",
              "/account/password/forgot/request",
              "/account/password/forgot/reset",
              "/account/token/refresh",
              "/global/health",
              "/doc",
            ]
            const protectedPaths = [
              "/account",
              "/agent",
              "/approval",
              "/auth",
              "/command",
              "/config",
              "/event",
              "/experimental",
              "/file",
              "/find",
              "/format",
              "/global",
              "/instance",
              "/log",
              "/mcp",
              "/openapi.json",
              "/path",
              "/permission",
              "/project",
              "/provider",
              "/pty",
              "/question",
              "/session",
              "/tui",
              "/vcs",
            ]
            const protected_ = protectedPaths.some((item) => path === item || path.startsWith(item + "/"))
            if (!protected_) return next()
            if (publicPaths.some((item) => path === item || path.startsWith(item + "/"))) return next()
            return (async () => {
              const debug = Flag.TPCODE_ACCOUNT_AUTH_DEBUG
              if (!accountSeeded) {
                await UserService.ensureSeedOnce()
                accountSeeded = true
              }
              const auth = c.req.header("authorization")
              const token = UserService.parseBearer(auth)
              if (!token) {
                if (debug) {
                  log.warn("account auth missing bearer", {
                    path,
                    method: c.req.method,
                    auth_present: !!auth,
                    auth_prefix: auth?.split(/\s+/)[0],
                    origin: c.req.header("origin"),
                    referer: c.req.header("referer"),
                    user_agent: c.req.header("user-agent"),
                  })
                }
                return c.json(
                  debug
                    ? {
                        error: "unauthorized",
                        reason: "missing_bearer",
                      }
                    : { error: "unauthorized" },
                  401,
                )
              }
              const detail = await UserService.authorizeDetail(token)
              if (!detail.ok) {
                if (debug) {
                  log.warn("account auth rejected", {
                    path,
                    method: c.req.method,
                    reason: detail.reason,
                    sid: detail.sid,
                    sub: detail.sub,
                    token_len: token.length,
                    origin: c.req.header("origin"),
                    referer: c.req.header("referer"),
                    user_agent: c.req.header("user-agent"),
                  })
                }
                return c.json(
                  debug
                    ? {
                        error: "unauthorized",
                        reason: detail.reason,
                      }
                    : { error: "unauthorized" },
                  401,
                )
              }
              const user = await (async () => {
                const context_project_id = detail.user.context_project_id
                if (!context_project_id) return detail.user
                const context = await contextProject(context_project_id)
                if (!context.project || !context.worktree_ready) {
                  clearContextProject(context_project_id)
                  log.warn("invalid account context project; forcing reselect", {
                    user_id: detail.user.id,
                    context_project_id,
                    project_found: !!context.project,
                    worktree: context.project?.worktree,
                  })
                  return {
                    ...detail.user,
                    context_project_id: undefined,
                  }
                }
                const allowed = await AccountContextService.canAccessProject({
                  user_id: detail.user.id,
                  project_id: context_project_id,
                })
                if (allowed) return detail.user
                AccountContextService.invalidateProjectAccess({
                  user_id: detail.user.id,
                  project_id: context_project_id,
                })
                log.warn("invalid account context project; forcing reselect", {
                  user_id: detail.user.id,
                  context_project_id,
                  project_found: true,
                  worktree: context.project?.worktree,
                  reason: "project_not_assigned",
                })
                return {
                  ...detail.user,
                  context_project_id: undefined,
                }
              })()
              c.set("account_user" as never, user)
              c.set("account_user_id" as never, user.id)
              c.set("account_org_id" as never, user.org_id)
              c.set("account_department_id" as never, user.department_id)
              c.set("account_context_project_id" as never, user.context_project_id)
              c.set("account_roles" as never, user.roles)
              c.set("account_permissions" as never, user.permissions)
              if (
                !path.startsWith("/account") &&
                path !== "/global/health" &&
                path !== "/agent" &&
                !user.context_project_id &&
                !user.permissions.includes("role:manage")
              ) {
                return c.json(
                  {
                    error: "project_context_required",
                  },
                  428,
                )
              }
              return AccountCurrent.provide(
                {
                  user_id: user.id,
                  org_id: user.org_id,
                  department_id: user.department_id,
                  context_project_id: user.context_project_id,
                  roles: user.roles,
                  permissions: user.permissions,
                },
                () => next(),
              )
            })()
          }
          // Allow CORS preflight requests to succeed without auth.
          // Browser clients sending Authorization headers will preflight with OPTIONS.
          const password = Flag.OPENCODE_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          const start = Date.now()
          if (!skipLogging && Flag.TPCODE_ACCOUNT_AUTH_DEBUG) {
            log.debug("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          await next()
          if (!skipLogging) {
            const duration = Date.now() - start
            if (duration >= 1000 || c.res.status >= 500) {
              log.warn("request slow", {
                method: c.req.method,
                path: c.req.path,
                status: c.res.status,
                duration,
              })
            }
          }
        })
        .route("/global", GlobalRoutes())
        .put(
          "/auth/:providerID",
          describeRoute({
            summary: "Set auth credentials",
            description: "Set authentication credentials",
            operationId: "auth.set",
            responses: {
              200: {
                description: "Successfully set authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            if (Flag.TPCODE_ACCOUNT_ENABLED) {
              const permissions = c.get("account_permissions" as never) as string[] | undefined
              if (!permissions?.includes("provider:config_global")) {
                return c.json(
                  {
                    error: "forbidden",
                    permission: "provider:config_global",
                  },
                  403,
                )
              }
            }
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            if (Flag.TPCODE_ACCOUNT_ENABLED) {
              await Auth.setGlobal(providerID, info)
            } else {
              await Auth.set(providerID, info)
            }
            return c.json(true)
          },
        )
        .delete(
          "/auth/:providerID",
          describeRoute({
            summary: "Remove auth credentials",
            description: "Remove authentication credentials",
            operationId: "auth.remove",
            responses: {
              200: {
                description: "Successfully removed authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          async (c) => {
            if (Flag.TPCODE_ACCOUNT_ENABLED) {
              const permissions = c.get("account_permissions" as never) as string[] | undefined
              if (!permissions?.includes("provider:config_global")) {
                return c.json(
                  {
                    error: "forbidden",
                    permission: "provider:config_global",
                  },
                  403,
                )
              }
            }
            const providerID = c.req.valid("param").providerID
            if (Flag.TPCODE_ACCOUNT_ENABLED) {
              await Auth.removeGlobal(providerID)
            } else {
              await Auth.remove(providerID)
            }
            return c.json(true)
          },
        )
        .route("/account", AccountRoutes())
        .all("/account/*", (c) =>
          c.json(
            {
              error: "account_route_missing",
            },
            404,
          ),
        )
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          if (c.req.path.startsWith("/account")) return next()
          if (lightInstancePath(c.req.path)) return next()
          const hinted = c.req.query("directory") || c.req.header("x-opencode-directory")
          const raw = hinted || process.cwd()
          let directory = decodeDirectory(raw)
          if (Flag.TPCODE_ACCOUNT_ENABLED) {
            const context_project_id = c.get("account_context_project_id" as never) as string | undefined
            if (context_project_id) {
              const context = await contextProject(context_project_id)
              if (context.project) directory = context.project.worktree
            }
          }
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              if (Flag.TPCODE_ACCOUNT_ENABLED) {
                const user_id = c.get("account_user_id" as never) as string | undefined
                const context_project_id = c.get("account_context_project_id" as never) as string | undefined
                if (user_id && context_project_id) {
                  if (Instance.project.id !== context_project_id) {
                    const context = await contextProject(context_project_id)
                    const expected = context.project?.worktree
                    if (!expected) return c.json({ error: "project_context_mismatch" }, 403)
                    const current = Filesystem.windowsPath(path.resolve(Instance.directory)).toLowerCase()
                    const target = Filesystem.windowsPath(path.resolve(expected)).toLowerCase()
                    if (current !== target) return c.json({ error: "project_context_mismatch" }, 403)
                  }
                }
              }
              return next()
            },
          })
        })
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "TpCode",
                version: "0.0.3",
                description: "TpCode API",
              },
              openapi: "3.1.1",
            },
          }),
        )
        .use(validator("query", z.object({ directory: z.string().optional() })))
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/approval", ApprovalRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/", FileRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes())
        .post(
          "/instance/dispose",
          describeRoute({
            summary: "Dispose instance",
            description: "Clean up and dispose the current TpCode instance, releasing all resources.",
            operationId: "instance.dispose",
            responses: {
              200: {
                description: "Instance disposed",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Instance.dispose()
            return c.json(true)
          },
        )
        .get(
          "/path",
          describeRoute({
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the TpCode instance.",
            operationId: "path.get",
            responses: {
              200: {
                description: "Path",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          home: z.string(),
                          state: z.string(),
                          config: z.string(),
                          worktree: z.string(),
                          directory: z.string(),
                        })
                        .meta({
                          ref: "Path",
                        }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              home: Global.Path.home,
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: Instance.worktree,
              directory: Instance.directory,
            })
          },
        )
        .get(
          "/vcs",
          describeRoute({
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
              200: {
                description: "VCS info",
                content: {
                  "application/json": {
                    schema: resolver(Vcs.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            const branch = await Vcs.branch()
            return c.json({
              branch,
            })
          },
        )
        .get(
          "/command",
          describeRoute({
            summary: "List commands",
            description: "Get a list of all available commands in the TpCode system.",
            operationId: "command.list",
            responses: {
              200: {
                description: "List of commands",
                content: {
                  "application/json": {
                    schema: resolver(Command.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const commands = await Command.list()
            return c.json(commands)
          },
        )
        .post(
          "/log",
          describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
              200: {
                description: "Log entry written successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              service: z.string().meta({ description: "Service name for the log entry" }),
              level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
              message: z.string().meta({ description: "Log message" }),
              extra: z
                .record(z.string(), z.any())
                .optional()
                .meta({ description: "Additional metadata for the log entry" }),
            }),
          ),
          async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
              case "debug":
                logger.debug(message, extra)
                break
              case "info":
                logger.info(message, extra)
                break
              case "error":
                logger.error(message, extra)
                break
              case "warn":
                logger.warn(message, extra)
                break
            }

            return c.json(true)
          },
        )
        .get(
          "/agent",
          describeRoute({
            summary: "List agents",
            description: "Get a list of all available AI agents in the TpCode system.",
            operationId: "app.agents",
            responses: {
              200: {
                description: "List of agents",
                content: {
                  "application/json": {
                    schema: resolver(Agent.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const list = await Agent.list()
            if (!Flag.TPCODE_ACCOUNT_ENABLED) return c.json(list)
            const permissions = (c.get("account_permissions" as never) as string[] | undefined) ?? []
            const required = {
              docs: "agent:use_docs",
              build: "agent:use_build",
            } as const
            return c.json(
              list.filter((item) => {
                const code = required[item.name as keyof typeof required]
                if (!code) return true
                return permissions.includes(code)
              }),
            )
          },
        )
        .get(
          "/skill",
          describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills in the TpCode system.",
            operationId: "app.skills",
            responses: {
              200: {
                description: "List of skills",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const skills = await Skill.all()
            return c.json(skills)
          },
        )
        .get(
          "/lsp",
          describeRoute({
            summary: "Get LSP status",
            description: "Get LSP server status",
            operationId: "lsp.status",
            responses: {
              200: {
                description: "LSP server status",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await LSP.status())
          },
        )
        .get(
          "/formatter",
          describeRoute({
            summary: "Get formatter status",
            description: "Get formatter status",
            operationId: "formatter.status",
            responses: {
              200: {
                description: "Formatter status",
                content: {
                  "application/json": {
                    schema: resolver(Format.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await Format.status())
          },
        )
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            c.header("X-Accel-Buffering", "no")
            c.header("X-Content-Type-Options", "nosniff")
            const accountUserID =
              Flag.TPCODE_ACCOUNT_ENABLED ? (c.get("account_user_id" as never) as string | undefined) : undefined
            const accountProjectID =
              Flag.TPCODE_ACCOUNT_ENABLED
                ? (c.get("account_context_project_id" as never) as string | undefined)
                : undefined
            return streamSSE(c, async (stream) => {
              const visibilityCache = Flag.TPCODE_EVENT_VISIBILITY_CACHE ? createEventVisibilityCache() : undefined
              const pending: Array<{ type: string; properties: Record<string, unknown> }> = []
              let timer: ReturnType<typeof setTimeout> | undefined
              let draining = false
              let closed = false
              const maxPending = 2000

              const close = (reason: string, error?: unknown) => {
                if (closed) return
                closed = true
                if (timer) {
                  clearTimeout(timer)
                  timer = undefined
                }
                if (error) {
                  log.error("closing event stream", { reason, error })
                } else {
                  log.warn("closing event stream", { reason })
                }
                stream.close()
              }

              const flush = async () => {
                if (draining || closed) return
                draining = true
                try {
                  while (pending.length > 0) {
                    const batch = pending.splice(0, 32)
                    if (visibilityCache) {
                      await warmEventVisibilityCache({
                        events: batch,
                        userID: accountUserID,
                        projectID: accountProjectID,
                        cache: visibilityCache,
                      })
                    }
                    for (const event of batch) {
                      if (closed) return
                      const sessionID = eventSessionID(event)
                      if ((event.type === "session.updated" || event.type === "session.deleted") && sessionID) {
                        visibilityCache?.delete(sessionID)
                      }
                      const visible = await eventVisibleToUser({
                        event,
                        userID: accountUserID,
                        projectID: accountProjectID,
                        cache: visibilityCache,
                      })
                      if (!visible) continue
                      await stream.writeSSE({
                        data: JSON.stringify(event),
                      })
                      if (event.type === Bus.InstanceDisposed.type) {
                        close("instance_disposed")
                        return
                      }
                    }
                  }
                } catch (error) {
                  close("flush_failed", error)
                } finally {
                  draining = false
                }
              }

              const queue = (event: { type: string; properties: Record<string, unknown> }) => {
                if (closed) return
                pending.push(event)
                if (pending.length > maxPending) {
                  close("queue_overflow")
                  return
                }
                if (timer) return
                timer = setTimeout(() => {
                  timer = undefined
                  void flush()
                }, 20)
              }

              await stream
                .writeSSE({
                  data: JSON.stringify({
                    type: "server.connected",
                    properties: {},
                  }),
                })
                .catch((error) => {
                  close("connected_write_failed", error)
                })
              if (closed) return
              const unsub = Bus.subscribeAll((event) => {
                queue(event as { type: string; properties: Record<string, unknown> })
              })

              // Send heartbeat every 10s to prevent stalled proxy streams.
              const heartbeat = setInterval(() => {
                if (closed) return
                stream
                  .writeSSE({
                    data: JSON.stringify({
                      type: "server.heartbeat",
                      properties: {},
                    }),
                  })
                  .catch((error) => {
                    close("heartbeat_write_failed", error)
                  })
              }, 10_000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  closed = true
                  if (timer) clearTimeout(timer)
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .all("/*", async (c) => {
          const requestPath = c.req.path
          const local = await webLocal(requestPath)
          if (local) {
            local.headers.set("Content-Security-Policy", webCsp)
            return local
          }
          if (!Flag.OPENCODE_WEB_ALLOW_REMOTE_PROXY) {
            return c.json(
              {
                error: "web_dist_missing",
                message: "Local web dist not found and remote proxy is disabled",
              },
              503,
            )
          }
          const response = await proxy(`https://app.opencode.ai${requestPath}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          response.headers.set("Content-Security-Policy", webCsp)
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "TpCode",
          version: "1.0.0",
          description: "TpCode API",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    _corsWhitelist = opts.cors ?? []
    webRoot()

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
