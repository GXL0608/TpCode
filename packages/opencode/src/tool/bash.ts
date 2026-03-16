import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { assertBuildCommandAllowed } from "@/session/build-protection"
import { Workspace } from "@/control-plane/workspace"
import { BuildOverlay } from "@/build/overlay"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

/** 中文注释：把 bash 工具的 workdir 统一规整为绝对路径，避免相对路径在不同执行环境下漂移。 */
function cwd(workdir?: string) {
  if (!workdir) return Instance.directory
  return path.isAbsolute(workdir) ? workdir : path.resolve(Instance.directory, workdir)
}

/** 中文注释：把 overlay 根目录里的路径映射到临时 merged sandbox，保持命令里的绝对路径仍然可执行。 */
function remap(command: string, from: string, to: string) {
  if (!from || from === to) return command
  return command.split(from).join(to)
}

/** 中文注释：把命令文本里的 overlay 根路径替换成临时 merged sandbox 路径，兼容正反斜杠形式。 */
function overlayCommand(command: string, overlayRoot: string, sandboxRoot: string) {
  const pairs = [
    [path.resolve(overlayRoot), path.resolve(sandboxRoot)],
    [path.resolve(overlayRoot).replaceAll("\\", "/"), path.resolve(sandboxRoot).replaceAll("\\", "/")],
    [Filesystem.windowsPath(path.resolve(overlayRoot)), Filesystem.windowsPath(path.resolve(sandboxRoot))],
  ] as const
  return pairs.reduce((text, [from, to]) => remap(text, from, to), command)
}

/** 中文注释：把 overlay 会话里的逻辑工作目录映射到临时 merged sandbox 的对应目录。 */
function overlayCwd(input: { cwd: string; overlayRoot: string; sandboxRoot: string }) {
  if (!Filesystem.contains(input.overlayRoot, input.cwd)) return input.cwd
  const relative = path.relative(path.resolve(input.overlayRoot), path.resolve(input.cwd))
  if (!relative || relative === ".") return input.sandboxRoot
  return path.join(input.sandboxRoot, relative)
}

/** 中文注释：在 overlay 会话下临时创建 merged sandbox，供 bash 读取完整源码并把改动回写到 overlay。 */
async function overlaySandbox(input: { sessionID: string; cwd: string; command: string }) {
  const overlay = await BuildOverlay.load(input.sessionID)
  if (!overlay || !Filesystem.contains(overlay.root, input.cwd)) return

  const workspace = await Workspace.createBatch({
    projectID: Instance.project.id,
    sourceRoots: [...new Set(overlay.mounts.map((item) => item.source_directory))],
    members: overlay.mounts.map((item) => ({
      directory: item.source_directory,
      name: item.mount_name,
      relative_path: item.mount_name,
    })),
    name: [input.sessionID, "bash", Date.now().toString(36)].join("-"),
  })

  for (const member of workspace.meta?.members ?? []) {
    const mount = overlay.mounts.find((item) => item.mount_name === member.relative_path)
    if (!mount) continue
    await BuildOverlay.applyToMount({
      overlay,
      solution_id: mount.solution_id,
      mount_name: mount.mount_name,
      target_directory: member.sandbox_directory,
    })
  }

  return {
    overlay,
    workspace,
    cwd: overlayCwd({
      cwd: input.cwd,
      overlayRoot: overlay.root,
      sandboxRoot: workspace.directory,
    }),
    command: overlayCommand(input.command, overlay.root, workspace.directory),
  }
}

/** 中文注释：把临时 merged sandbox 的最终文件状态收敛回 overlay，再清理临时目录。 */
async function settleOverlaySandbox(input?: Awaited<ReturnType<typeof overlaySandbox>>) {
  if (!input) return
  try {
    for (const member of input.workspace.meta?.members ?? []) {
      await BuildOverlay.captureMount({
        overlay: input.overlay,
        mount_name: member.relative_path,
        target_directory: member.sandbox_directory,
      })
    }
  } finally {
    await Workspace.removeBatch(input.workspace.id).catch(() => undefined)
  }
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const directory = cwd(params.workdir)
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      await assertBuildCommandAllowed({
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        command: params.command,
        cwd: directory,
      })
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(directory)) directories.add(directory)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .cwd(directory)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              const normalized =
                process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)
              }
            }
          }
        }

        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const sandbox = await overlaySandbox({
        sessionID: ctx.sessionID,
        cwd: directory,
        command: params.command,
      })
      const actualCwd = sandbox?.cwd ?? directory
      const actualCommand = sandbox?.command ?? params.command
      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd: actualCwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )

      let output = ""

      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
          cwd: actualCwd,
          overlay_root: sandbox?.overlay.root,
          bash_sandbox_directory: sandbox?.workspace.directory,
        },
      })

      try {
        const proc = spawn(actualCommand, {
          shell,
          cwd: actualCwd,
          env: {
            ...process.env,
            ...shellEnv.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })

        const append = (chunk: Buffer) => {
          output += chunk.toString()
          ctx.metadata({
            metadata: {
              output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
              description: params.description,
              cwd: actualCwd,
              overlay_root: sandbox?.overlay.root,
              bash_sandbox_directory: sandbox?.workspace.directory,
            },
          })
        }

        proc.stdout?.on("data", append)
        proc.stderr?.on("data", append)

        let timedOut = false
        let aborted = false
        let exited = false

        const kill = () => Shell.killTree(proc, { exited: () => exited })

        if (ctx.abort.aborted) {
          aborted = true
          await kill()
        }

        const abortHandler = () => {
          aborted = true
          void kill()
        }

        ctx.abort.addEventListener("abort", abortHandler, { once: true })

        const timeoutTimer = setTimeout(() => {
          timedOut = true
          void kill()
        }, timeout + 100)

        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeoutTimer)
            ctx.abort.removeEventListener("abort", abortHandler)
          }

          proc.once("exit", () => {
            exited = true
            cleanup()
            resolve()
          })

          proc.once("error", (error) => {
            exited = true
            cleanup()
            reject(error)
          })
        })

        const resultMetadata: string[] = []

        if (timedOut) {
          resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
        }

        if (aborted) {
          resultMetadata.push("User aborted the command")
        }

        if (resultMetadata.length > 0) {
          output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
        }

        return {
          title: params.description,
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            exit: proc.exitCode,
            description: params.description,
            cwd: actualCwd,
            overlay_root: sandbox?.overlay.root,
            bash_sandbox_directory: sandbox?.workspace.directory,
          },
          output,
        }
      } finally {
        await settleOverlaySandbox(sandbox)
      }
    },
  }
})
