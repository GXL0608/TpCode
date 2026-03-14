import { fn } from "@/util/fn"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { Session } from "."

import { MessageV2 } from "./message-v2"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"

import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"
import { NotFoundError } from "@/storage/db"
import { Workspace } from "@/control-plane/workspace"
import type { BatchMember } from "@/control-plane/workspace-meta"

export namespace SessionSummary {
  function missing(error: unknown) {
    if (error instanceof NotFoundError) return true
    if (!(error instanceof Error)) return false
    return error.message.startsWith("Session not found:") || error.message.startsWith("Message not found:")
  }

  function unquoteGitPath(input: string) {
    if (!input.startsWith('"')) return input
    if (!input.endsWith('"')) return input
    const body = input.slice(1, -1)
    const bytes: number[] = []

    for (let i = 0; i < body.length; i++) {
      const char = body[i]!
      if (char !== "\\") {
        bytes.push(char.charCodeAt(0))
        continue
      }

      const next = body[i + 1]
      if (!next) {
        bytes.push("\\".charCodeAt(0))
        continue
      }

      if (next >= "0" && next <= "7") {
        const chunk = body.slice(i + 1, i + 4)
        const match = chunk.match(/^[0-7]{1,3}/)
        if (!match) {
          bytes.push(next.charCodeAt(0))
          i++
          continue
        }
        bytes.push(parseInt(match[0], 8))
        i += match[0].length
        continue
      }

      const escaped =
        next === "n"
          ? "\n"
          : next === "r"
            ? "\r"
            : next === "t"
              ? "\t"
              : next === "b"
                ? "\b"
                : next === "f"
                  ? "\f"
                  : next === "v"
                    ? "\v"
                    : next === "\\" || next === '"'
                      ? next
                      : undefined

      bytes.push((escaped ?? next).charCodeAt(0))
      i++
    }

    return Buffer.from(bytes).toString()
  }

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      const all = await Session.messages({ sessionID: input.sessionID }).catch((error) => {
        if (missing(error)) return
        throw error
      })
      if (!all) return
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ]).catch((error) => {
        if (missing(error)) return
        throw error
      })
    },
  )

  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    const diffs = await computeDiff({ sessionID: input.sessionID, messages: input.messages })
    await Session.setSummary({
      sessionID: input.sessionID,
      summary: {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      },
    }).catch((error) => {
      if (missing(error)) return
      throw error
    })
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    const messages = input.messages.filter(
      (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
    )
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)
    if (!msgWithParts) return
    if (msgWithParts.info.role !== "user") return
    const userMsg = msgWithParts.info as MessageV2.User
    const diffs = await computeDiff({ sessionID: msgWithParts.info.sessionID, messages })
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg).catch((error) => {
      if (missing(error)) return
      throw error
    })
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      await Session.get(input.sessionID)
      const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
      const next = diffs.map((item) => {
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return {
          ...item,
          file,
        }
      })
      const changed = next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) Storage.write(["session_diff", input.sessionID], next).catch(() => {})
      return next
    },
  )

  /** 中文注释：统计文本的近似行数，供 batch 模式无 numstat 时回退使用。 */
  function lineCount(input: string) {
    if (!input) return 0
    return input.split("\n").length
  }

  /** 中文注释：按 git porcelain 结果把文件统一映射成 added/deleted/modified。 */
  function statusFromPorcelain(code: string) {
    if (code === "??") return "added" as const
    if (code.includes("D")) return "deleted" as const
    if (code.includes("A")) return "added" as const
    return "modified" as const
  }

  /** 中文注释：读取 batch 成员在当前会话中的累计 diff，并把路径前缀回成员相对路径。 */
  async function batchMemberDiff(member: BatchMember) {
    const base = member.base_ref ?? "HEAD"
    const cwd = member.sandbox_directory
    const status = new Map<string, "added" | "deleted" | "modified">()
    const counts = new Map<string, { additions: number; deletions: number }>()

    const changed = await $`git -c core.quotepath=false diff --name-status --no-renames ${base} -- .`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
    for (const line of changed.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      status.set(unquoteGitPath(file), code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
    }

    const numstat = await $`git -c core.quotepath=false diff --numstat --no-renames ${base} -- .`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
    for (const line of numstat.trim().split("\n")) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      if (!file) continue
      counts.set(unquoteGitPath(file), {
        additions: additions === "-" ? 0 : Number.parseInt(additions || "0", 10) || 0,
        deletions: deletions === "-" ? 0 : Number.parseInt(deletions || "0", 10) || 0,
      })
    }

    const porcelain = await $`git -c core.quotepath=false status --porcelain=v1 --untracked-files=all`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
    for (const line of porcelain.trim().split("\n")) {
      if (!line) continue
      const code = line.slice(0, 2)
      const file = unquoteGitPath(line.slice(3).trim())
      if (!file) continue
      status.set(file, statusFromPorcelain(code))
    }

    const files = [...status.keys()].sort()
    return Promise.all(
      files.map(async (file) => {
        const kind = status.get(file) ?? "modified"
        const before =
          kind === "added"
            ? ""
            : await $`git show ${base}:${file}`
                .quiet()
                .nothrow()
                .cwd(cwd)
                .text()
                .catch(() => "")
        const after =
          kind === "deleted"
            ? ""
            : await Bun.file(path.join(cwd, file))
                .text()
                .catch(() => "")
        const stat = counts.get(file) ?? {
          additions: kind === "added" ? lineCount(after) : kind === "modified" ? lineCount(after) : 0,
          deletions: kind === "deleted" ? lineCount(before) : kind === "modified" ? lineCount(before) : 0,
        }
        return {
          file: path.join(member.relative_path, file).replaceAll("\\", "/"),
          before,
          after,
          additions: stat.additions,
          deletions: stat.deletions,
          status: kind,
        } satisfies Snapshot.FileDiff
      }),
    )
  }

  /** 中文注释：批量沙盒模式下基于各成员仓库基线提交汇总累计 diff，供 review 与 summary 复用。 */
  async function batchDiff(sessionID: string) {
    const session = await Session.get(sessionID)
    if (session.workspaceKind !== "batch_worktree" || !session.workspaceID) return []
    const workspace = await Workspace.get(session.workspaceID)
    if (!workspace?.meta) return []
    return (await Promise.all(workspace.meta.members.map((member) => batchMemberDiff(member)))).flat()
  }

  export async function computeDiff(input: { sessionID?: string; messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    // scan assistant messages to find earliest from and latest to
    // snapshot
    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to)
    if (input.sessionID) return batchDiff(input.sessionID)
    return []
  }
}
