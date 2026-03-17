import z from "zod"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"
import { Glob } from "../util/glob"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"
import { BuildOverlay } from "@/build/overlay"

const MAX_LINE_LENGTH = 2000

type Match = {
  path: string
  modTime: number
  lineNum: number
  lineText: string
}

/** 中文注释：把文本按行执行正则匹配，并产出 grep 统一结果结构。 */
function collect(input: {
  pattern: string
  text: string
  filePath: string
  modTime: number
}) {
  const regexp = new RegExp(input.pattern, "g")
  const matches = [] as Match[]
  for (const [index, line] of input.text.split(/\r?\n/).entries()) {
    regexp.lastIndex = 0
    if (!regexp.test(line)) continue
    matches.push({
      path: input.filePath,
      modTime: input.modTime,
      lineNum: index + 1,
      lineText: line,
    })
  }
  return matches
}

/** 中文注释：统一把 grep 命中的相对路径规范成稳定 POSIX 形式，便于和 overlay 变更路径比对。 */
function relative(input: string) {
  return input.replaceAll("\\", "/").replace(/^\/+/, "")
}

/** 中文注释：生成 overlay grep 需要的 glob 规则，并默认跳过常见大体积编译产物目录。 */
function globs(include?: string) {
  return [
    ...(include ? [include] : []),
    "!**/node_modules/**",
    "!**/bin/**",
    "!**/obj/**",
    "!**/dist/**",
    "!**/target/**",
    "!**/.idea/**",
    "!**/.vs/**",
    "!**/.ai__build/**",
  ]
}

/** 中文注释：根据 overlay 搜索路径拆出挂载名与挂载内相对路径，供源码目录和 overlay 目录做一一映射。 */
function scope(input: { overlay: BuildOverlay.Info; searchPath: string }) {
  const rel = relative(path.relative(input.overlay.root, input.searchPath))
  if (!rel || rel === ".") {
    return input.overlay.mounts.map((item) => ({
      mount: item,
      virtual_root: path.join(input.overlay.root, item.mount_name),
      source_root: item.source_directory,
      subpath: "",
    }))
  }
  const [mount_name, ...rest] = rel.split("/")
  const mount = input.overlay.mounts.find((item) => item.mount_name === mount_name)
  if (!mount) return []
  const subpath = relative(rest.join("/"))
  return [
    {
      mount,
      virtual_root: subpath ? path.join(input.overlay.root, mount.mount_name, subpath) : path.join(input.overlay.root, mount.mount_name),
      source_root: subpath ? path.join(mount.source_directory, subpath) : mount.source_directory,
      subpath,
    },
  ]
}

/** 中文注释：overlay 模式下优先用源码 ripgrep，再仅对改动文件做增量合并，避免对整个大仓逐文件慢扫。 */
export async function searchOverlay(input: {
  overlay: BuildOverlay.Info
  pattern: string
  searchPath: string
  include?: string
}) {
  const matches = [] as Match[]
  const changes = await BuildOverlay.listChanges(input.overlay)

  for (const entry of scope(input)) {
    const scoped = changes.filter((item) => {
      if (item.mount_name !== entry.mount.mount_name) return false
      if (!entry.subpath) return true
      return item.relative_path === entry.subpath || item.relative_path.startsWith(entry.subpath + "/")
    })
    const changed = new Set(
      scoped.map((item) =>
        relative(entry.subpath ? path.posix.relative(entry.subpath, item.relative_path) : item.relative_path),
      ),
    )

    if (await Bun.file(entry.source_root).exists()) {
      const source = await Ripgrep.search({
        cwd: entry.source_root,
        pattern: input.pattern,
        glob: globs(input.include),
      })
      for (const item of source) {
        const rel = relative(item.path.text)
        if (changed.has(rel)) continue
        const filePath = path.join(entry.virtual_root, rel)
        const stat = await BuildOverlay.stat({ overlay: input.overlay, filePath })
        if (!stat) continue
        matches.push({
          path: filePath,
          modTime: stat.mtime.getTime(),
          lineNum: item.line_number,
          lineText: item.lines.text.replace(/\r?\n$/, ""),
        })
      }
    }

    for (const item of scoped) {
      if (item.change_type === "delete") continue
      const rel = relative(entry.subpath ? path.posix.relative(entry.subpath, item.relative_path) : item.relative_path)
      if (input.include && !Glob.match(input.include, rel)) continue
      const filePath = path.join(entry.virtual_root, rel)
      const stat = await BuildOverlay.stat({ overlay: input.overlay, filePath })
      if (!stat?.isFile()) continue
      matches.push(
        ...collect({
          pattern: input.pattern,
          text: await BuildOverlay.readText({ overlay: input.overlay, filePath }),
          filePath,
          modTime: stat.mtime.getTime(),
        }),
      )
    }
  }

  return matches
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    const overlay = await BuildOverlay.load(ctx.sessionID)
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    if (overlay) searchPath = BuildOverlay.remapSourcePath({ overlay, filePath: searchPath })
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    if (overlay && (await BuildOverlay.stat({ overlay, filePath: searchPath }))) {
      const matches = await searchOverlay({
        overlay,
        pattern: params.pattern,
        searchPath,
        include: params.include,
      })
      matches.sort((a, b) => b.modTime - a.modTime)
      const limit = 100
      const truncated = matches.length > limit
      const finalMatches = truncated ? matches.slice(0, limit) : matches
      if (finalMatches.length === 0) {
        return {
          title: params.pattern,
          metadata: { matches: 0, truncated: false },
          output: "No files found",
        }
      }
      const totalMatches = matches.length
      const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]
      let currentFile = ""
      for (const match of finalMatches) {
        if (currentFile !== match.path) {
          if (currentFile !== "") outputLines.push("")
          currentFile = match.path
          outputLines.push(`${match.path}:`)
        }
        const truncatedLineText =
          match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
        outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
      }
      if (truncated) {
        outputLines.push("")
        outputLines.push(
          `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
        )
      }
      return {
        title: params.pattern,
        metadata: {
          matches: totalMatches,
          truncated,
        },
        output: outputLines.join("\n"),
      }
    }

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Process.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      abort: ctx.abort,
    })

    if (!proc.stdout || !proc.stderr) {
      throw new Error("Process output not available")
    }

    const output = await text(proc.stdout)
    const errorOutput = await text(proc.stderr)
    const exitCode = await proc.exited

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    // Only fail if exit code is 2 AND no output was produced
    if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = exitCode === 2

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    for (const line of lines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const stats = Filesystem.stat(filePath)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(
        `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
