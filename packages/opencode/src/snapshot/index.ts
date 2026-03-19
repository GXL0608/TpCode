import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { spawnSync } from "child_process"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
  }

  function runGit(input: {
    args: string[]
    cwd: string
    env?: Record<string, string>
    timeout?: number
  }) {
    const result = spawnSync("git", input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
      windowsHide: true,
      encoding: "utf-8",
      timeout: input.timeout ?? 3000,
    })
    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    }
  }

  export async function track() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const initialized = await fs
      .stat(path.join(git, "HEAD"))
      .then(() => true)
      .catch(() => false)
    await fs.mkdir(git, { recursive: true })
    if (!initialized) {
      const init = runGit({
        args: ["init"],
        cwd: Instance.directory,
        env: {
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        },
        timeout: 5000,
      })
      if (init.exitCode !== 0) {
        log.warn("failed to initialize snapshot repo", {
          cwd: Instance.directory,
          git,
          stderr: init.stderr,
          stdout: init.stdout,
          exitCode: init.exitCode,
          error: init.error,
        })
        return
      }
      // Configure git to not convert line endings on Windows
      for (const [key, value] of [
        ["core.autocrlf", "false"],
        ["core.longpaths", "true"],
        ["core.symlinks", "true"],
        ["core.fsmonitor", "false"],
      ] as const) {
        const config = runGit({
          args: ["--git-dir", git, "config", key, value],
          cwd: Instance.directory,
        })
        if (config.exitCode !== 0) {
          log.warn("failed to configure snapshot repo", {
            cwd: Instance.directory,
            git,
            key,
            value,
            stderr: config.stderr,
            stdout: config.stdout,
            exitCode: config.exitCode,
            error: config.error,
          })
          return
        }
      }
      log.info("initialized")
    }
    const added = await add(git)
    if (!added) return
    const tree = runGit({
      args: ["--git-dir", git, "--work-tree", Instance.worktree, "write-tree"],
      cwd: Instance.directory,
    })
    if (tree.exitCode !== 0) {
      log.warn("failed to write snapshot tree", {
        cwd: Instance.directory,
        git,
        stderr: tree.stderr,
        stdout: tree.stdout,
        exitCode: tree.exitCode,
        error: tree.error,
      })
      return
    }
    const hash = tree.stdout
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x).replaceAll("\\", "/")),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result =
          await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
            .quiet()
            .cwd(Instance.worktree)
            .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file) ?? "modified",
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }

  async function add(git: string) {
    await syncExclude(git)
    const result = runGit({
      args: [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.longpaths=true",
        "-c",
        "core.symlinks=true",
        "--git-dir",
        git,
        "--work-tree",
        Instance.worktree,
        "add",
        ".",
      ],
      cwd: Instance.directory,
    })
    if (result.exitCode !== 0) {
      log.warn("failed to stage snapshot worktree", {
        cwd: Instance.directory,
        git,
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        error: result.error,
      })
      return false
    }
    return true
  }

  async function syncExclude(git: string) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    if (!file) {
      await Bun.write(target, "")
      return
    }
    const text = await Bun.file(file)
      .text()
      .catch(() => "")
    await Bun.write(target, text)
  }

  async function excludes() {
    const file = await $`git rev-parse --path-format=absolute --git-path info/exclude`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
      .text()
    if (!file.trim()) return
    const exists = await fs
      .stat(file.trim())
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    return file.trim()
  }
}
