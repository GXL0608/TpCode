import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { BuildOverlay } from "@/build/overlay"

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
  }),
  async execute(params, ctx) {
    const overlay = await BuildOverlay.load(ctx.sessionID)
    const timeout = Number(process.env.TPCODE_GLOB_TIMEOUT_MS ?? 15000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error("glob search timeout")), timeout)
    const signal = AbortSignal.any([ctx.abort, controller.signal])
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    if (overlay) search = BuildOverlay.remapSourcePath({ overlay, filePath: search })
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const limit = 100
    const files = []
    let truncated = false
    try {
      if (overlay && (await BuildOverlay.stat({ overlay, filePath: search }))) {
        for (const full of await BuildOverlay.scanFiles({
          overlay,
          directory: search,
          pattern: params.pattern,
          limit: limit + 1,
          signal,
        })) {
          if (files.length >= limit) {
            truncated = true
            break
          }
          const stats = (await BuildOverlay.stat({ overlay, filePath: full }))?.mtime.getTime() ?? 0
          files.push({
            path: full,
            mtime: stats,
          })
        }
      } else {
        for await (const file of Ripgrep.files({
          cwd: search,
          glob: [params.pattern],
          signal,
        })) {
          if (files.length >= limit) {
            truncated = true
            break
          }
          const full = path.resolve(search, file)
          const stats = Filesystem.stat(full)?.mtime.getTime() ?? 0
          files.push({
            path: full,
            mtime: stats,
          })
        }
      }
    } catch (error) {
      if (controller.signal.aborted && !ctx.abort.aborted) {
        throw new Error(`Glob search timed out after ${Math.ceil(timeout / 1000)} seconds in ${search}`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        )
      }
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
