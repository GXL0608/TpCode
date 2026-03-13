import os from "os"
import path from "path"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { ProjectTable } from "@/project/project.sql"
import { Database, eq } from "@/storage/db"
import { SessionTable } from "./session.sql"
import { Filesystem } from "@/util/filesystem"

/** 中文注释：build 模式下禁止向主工作区写入时抛出的统一错误。 */
export const BuildMainWorktreeWriteDeniedError = NamedError.create(
  "BuildMainWorktreeWriteDeniedError",
  z.object({
    message: z.string(),
  }),
)

/** 中文注释：build 模式下禁止向受保护默认分支推送时抛出的统一错误。 */
export const BuildProtectedBranchPushDeniedError = NamedError.create(
  "BuildProtectedBranchPushDeniedError",
  z.object({
    message: z.string(),
  }),
)

type BuildContext = {
  project: string
  workspace?: string
}

/** 中文注释：统一判断当前调用是否需要启用 build 主目录写保护。 */
async function context(input: { sessionID: string; agent?: string }) {
  if (input.agent !== "build") return
  const row = await Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get())
  if (!row?.project_id) return
  const project = await Database.use((db) =>
    db.select().from(ProjectTable).where(eq(ProjectTable.id, row.project_id)).get(),
  )
  if (!project || project.vcs !== "git" || project.worktree === "/") return
  return {
    project: path.resolve(project.worktree),
    workspace: row.workspace_directory ? path.resolve(row.workspace_directory) : undefined,
  } satisfies BuildContext
}

/** 中文注释：返回 build 模式统一使用的主工作区写保护提示。 */
function writeDenied() {
  return new BuildMainWorktreeWriteDeniedError({
    message: "Build 模式禁止写入主工作区，请在当前工作区沙盒内操作",
  })
}

/** 中文注释：去掉命令参数两端的引号，便于后续做路径和分支判断。 */
function unquote(input: string) {
  return input.replace(/^['"]|['"]$/g, "")
}

/** 中文注释：按最小需求切分 shell 命令片段，覆盖换行、分号和常见逻辑连接符。 */
function segments(command: string) {
  return command
    .split(/&&|\|\||;|\n/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 中文注释：把命令片段切成基础 token，用于主目录写和 push 保护判断。 */
function tokens(command: string) {
  return command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g)?.map(unquote) ?? []
}

/** 中文注释：把路径参数解析成绝对路径，仅处理显式路径与重定向目标。 */
function resolveTarget(token: string, cwd: string) {
  if (!token) return
  if (token === "-" || token === "--") return
  if (token.startsWith("-")) return
  if (token.startsWith("http://") || token.startsWith("https://")) return
  if (token.includes("://")) return
  if (token.includes(":") && !path.isAbsolute(token)) return
  if (token === "." || token === "..") return path.resolve(cwd, token)
  if (token.startsWith("~")) return path.resolve(os.homedir(), token.slice(1))
  return path.resolve(cwd, token)
}

/** 中文注释：提取高风险写命令显式指向的目标路径。 */
function targets(command: string, cwd: string) {
  const parts = tokens(command)
  if (parts.length === 0) return []

  const gitWrite = parts[0] === "git" && ["checkout", "restore"].includes(parts[1] ?? "")
  const write =
    gitWrite ||
    ["rm", "mv", "cp", "rsync", "mkdir", "touch"].includes(parts[0] ?? "")

  const result = new Set<string>()
  if (write) {
    const list = gitWrite
      ? parts.includes("--")
        ? parts.slice(parts.indexOf("--") + 1)
        : []
      : parts.slice(1)
    for (const item of list) {
      const resolved = resolveTarget(item, cwd)
      if (resolved) result.add(resolved)
    }
  }

  for (const match of command.matchAll(/(?:^|[\s;&|])>>?\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s;&|]+)/g)) {
    const resolved = resolveTarget(unquote(match[1] ?? ""), cwd)
    if (resolved) result.add(resolved)
  }

  return [...result]
}

/** 中文注释：解析当前仓库的受保护默认分支，优先 remote HEAD，失败时回退 main/master/dev。 */
async function defaultBranch(cwd: string) {
  const remote = await $`git symbolic-ref refs/remotes/origin/HEAD`.quiet().nothrow().cwd(cwd)
  if (remote.exitCode === 0) {
    const ref = remote.stdout.toString().trim()
    const branch = ref.replace(/^refs\/remotes\/origin\//, "")
    if (branch) return branch
  }

  for (const item of ["main", "master", "dev"] as const) {
    const found = await $`git show-ref --verify --quiet refs/heads/${item}`.quiet().nothrow().cwd(cwd)
    if (found.exitCode === 0) return item
  }
}

/** 中文注释：读取当前命令执行目录所在仓库的当前分支，供 push 保护判断。 */
async function currentBranch(cwd: string) {
  const result = await $`git branch --show-current`.quiet().nothrow().cwd(cwd)
  if (result.exitCode !== 0) return ""
  return result.stdout.toString().trim()
}

/** 中文注释：判断 refspec 是否会把代码推送到受保护默认分支。 */
function protectedRef(input: { ref: string; branch: string; protectedBranch: string }) {
  if (input.ref === input.protectedBranch) return true
  if (input.ref === "HEAD" && input.branch === input.protectedBranch) return true
  if (!input.ref.includes(":")) return false
  const target = input.ref.split(":").at(-1)?.trim()
  if (!target) return false
  return target === input.protectedBranch
}

/** 中文注释：校验 build 模式下的显式目标路径，禁止把主工作区作为写入目标。 */
export async function assertBuildWriteTarget(input: { sessionID: string; agent?: string; target?: string }) {
  const state = await context(input)
  if (!state || !input.target) return
  const target = path.resolve(input.target)
  if (!Filesystem.contains(state.project, target)) return
  if (state.workspace && Filesystem.contains(state.workspace, target)) return
  throw writeDenied()
}

/** 中文注释：校验 build 模式 shell/command 文本，禁止显式写主工作区或推送受保护默认分支。 */
export async function assertBuildCommandAllowed(input: {
  sessionID: string
  agent?: string
  command: string
  cwd: string
}) {
  const state = await context(input)
  if (!state) return

  for (const item of segments(input.command)) {
    for (const target of targets(item, input.cwd)) {
      if (!Filesystem.contains(state.project, target)) continue
      if (state.workspace && Filesystem.contains(state.workspace, target)) continue
      throw writeDenied()
    }

    const parts = tokens(item)
    if (parts[0] !== "git" || parts[1] !== "push") continue
    const protectedBranch = await defaultBranch(input.cwd)
    if (!protectedBranch) continue
    const branch = await currentBranch(input.cwd)
    const args = parts.slice(2).filter((part) => !part.startsWith("-"))

    if (args.length === 0) {
      if (branch === protectedBranch) {
        throw new BuildProtectedBranchPushDeniedError({
          message: `禁止推送到受保护主分支 ${protectedBranch}，请推送到其他分支`,
        })
      }
      continue
    }

    if (args.length === 1) {
      const ref = args[0]
      if (ref === protectedBranch || protectedRef({ ref, branch, protectedBranch })) {
        throw new BuildProtectedBranchPushDeniedError({
          message: `禁止推送到受保护主分支 ${protectedBranch}，请推送到其他分支`,
        })
      }
      if (!ref.includes(":") && !ref.includes("/") && branch === protectedBranch) {
        throw new BuildProtectedBranchPushDeniedError({
          message: `禁止推送到受保护主分支 ${protectedBranch}，请推送到其他分支`,
        })
      }
      continue
    }

    for (const ref of args.slice(1)) {
      if (!protectedRef({ ref, branch, protectedBranch }) && ref !== protectedBranch) continue
      throw new BuildProtectedBranchPushDeniedError({
        message: `禁止推送到受保护主分支 ${protectedBranch}，请推送到其他分支`,
      })
    }
  }
}
