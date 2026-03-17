import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@opencode-ai/util/error"
import { text } from "node:stream/consumers"
import { Lock } from "../util/lock"
import { PackageRegistry } from "./registry"
import { proxied } from "@/util/proxied"
import { Process } from "../util/process"

export namespace BunProc {
  const log = Log.create({ service: "bun" })
  const INSTALL_BACKOFF_MS = 300_000
  const installBackoff = new Map<string, { expires_at: number; error: string }>()

  /** 中文注释：把包名和版本收敛成稳定键，供安装失败退避缓存复用。 */
  function installKey(pkg: string, version: string) {
    return `${pkg}@${version}`
  }

  export async function run(cmd: string[], options?: Process.Options) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Process.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout ? await text(result.stdout) : undefined
    const stderr = result.stderr ? await text(result.stderr) : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${code}`)
    }
    return result
  }

  export function which() {
    return process.execPath
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export const InstallBackoffError = NamedError.create(
    "BunInstallBackoffError",
    z.object({
      pkg: z.string(),
      version: z.string(),
      retry_at: z.number(),
    }),
  )

  /** 中文注释：测试与运维排障时可主动清空安装失败退避状态，避免历史失败影响新结论。 */
  export function resetInstallBackoff() {
    installBackoff.clear()
  }

  export async function install(pkg: string, version = "latest") {
    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")
    const key = installKey(pkg, version)
    const cooled = installBackoff.get(key)
    if (cooled && cooled.expires_at > Date.now()) {
      throw new InstallBackoffError(
        {
          pkg,
          version,
          retry_at: cooled.expires_at,
        },
        {
          cause: new Error(cooled.error),
        },
      )
    }
    if (cooled) installBackoff.delete(key)

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    const parsed = await Filesystem.readJson<{ dependencies: Record<string, string> }>(pkgjsonPath).catch(async () => {
      const result = { dependencies: {} as Record<string, string> }
      await Filesystem.writeJson(pkgjsonPath, result)
      return result
    })
    if (!parsed.dependencies) parsed.dependencies = {} as Record<string, string>
    const dependencies = parsed.dependencies
    const modExists = await Filesystem.exists(mod)
    const cachedVersion = dependencies[pkg]

    if (!modExists || !cachedVersion) {
      // continue to install
    } else if (version !== "latest" && cachedVersion === version) {
      return mod
    } else if (version === "latest") {
      const isOutdated = await PackageRegistry.isOutdated(pkg, cachedVersion, Global.Path.cache)
      if (!isOutdated) return mod
      log.info("Cached version is outdated, proceeding with install", { pkg, cachedVersion })
    }

    // Build command arguments
    const args = [
      "add",
      "--force",
      "--exact",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() || process.env.CI ? ["--no-cache"] : []),
      "--cwd",
      Global.Path.cache,
      pkg + "@" + version,
    ]

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e)
      installBackoff.set(key, {
        expires_at: Date.now() + INSTALL_BACKOFF_MS,
        error: cause,
      })
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })
    installBackoff.delete(key)

    // Resolve actual version from installed package when using "latest"
    // This ensures subsequent starts use the cached version until explicitly updated
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkg = await Filesystem.readJson<{ version?: string }>(path.join(mod, "package.json")).catch(
        () => null,
      )
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    parsed.dependencies[pkg] = resolvedVersion
    await Filesystem.writeJson(pkgjsonPath, parsed)
    return mod
  }
}
