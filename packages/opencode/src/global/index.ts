import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "opencode"
const sharedRoot = "Y:\\tpcode"

/** 根据共享根路径选择合适的路径拼接方式，确保 Windows 共享盘前缀在非 Windows 测试环境下也能保持原样。 */
function join(root: string, ...parts: string[]) {
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(root)) return path.win32.join(root, ...parts)
  return path.join(root, ...parts)
}

/** 判断当前运行时是否仍然属于本地开发模式。 */
function local() {
  if (typeof OPENCODE_CHANNEL !== "string") return true
  return OPENCODE_CHANNEL === "local"
}

/** 解析 TpCode 在当前运行模式下应使用的公共目录。 */
export function resolvePaths(input: {
  local: boolean
  sharedRoot?: string
  xdg: {
    data: string
    cache: string
    config: string
    state: string
  }
}) {
  if (input.local) {
    const data = path.join(input.xdg.data, app)
    const cache = path.join(input.xdg.cache, app)
    const config = path.join(input.xdg.config, app)
    const state = path.join(input.xdg.state, app)
    return {
      data,
      cache,
      config,
      state,
      bin: path.join(data, "bin"),
      log: path.join(data, "log"),
    }
  }

  const root = input.sharedRoot || sharedRoot
  const data = join(root, ".local", "share", app)
  return {
    data,
    cache: join(root, ".cache", app),
    config: join(root, ".config", app),
    state: join(root, ".local", "state", app),
    bin: join(data, "bin"),
    log: join(data, "log"),
  }
}

const paths = resolvePaths({
  local: local(),
  sharedRoot: process.env.TPCODE_SHARED_ROOT?.trim() || undefined,
  xdg: {
    data: xdgData!,
    cache: xdgCache!,
    config: xdgConfig!,
    state: xdgState!,
  },
})

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data: paths.data,
    bin: paths.bin,
    log: paths.log,
    cache: paths.cache,
    config: paths.config,
    state: paths.state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
