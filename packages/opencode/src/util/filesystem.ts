import { chmod, mkdir, readFile, writeFile } from "fs/promises"
import { createWriteStream, existsSync, statSync } from "fs"
import { lookup } from "mime-types"
import { realpathSync } from "fs"
import { dirname, join, relative, resolve } from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { Glob } from "./glob"

export namespace Filesystem {
  /** 中文注释：识别 Windows 盘符路径，供非 Windows 环境把 Y:\ 之类路径映射到共享挂载目录。 */
  function drive(input: string) {
    const current = input.trim()
    const match = current.match(/^([a-zA-Z]):(?:[\\/]+(.*))?$/)
    if (!match) return
    return {
      letter: match[1].toUpperCase(),
      rest: match[2]?.split(/[\\/]+/).filter(Boolean) ?? [],
    }
  }

  /** 中文注释：识别 Windows UNC 共享路径，供 macOS/Linux 本地开发时映射到已挂载共享目录。 */
  function shared(input: string) {
    const current = input.trim().replaceAll("/", "\\")
    if (!current.startsWith("\\\\")) return
    const parts = current.replace(/^\\\\+/, "").split("\\").filter(Boolean)
    if (parts.length < 2) return
    return {
      server: parts[0],
      share: parts[1],
      rest: parts.slice(2),
    }
  }

  /** 中文注释：读取盘符到共享路径或本地挂载目录的映射，便于在 macOS/Linux 上访问 Windows 盘符配置。 */
  function driveMap() {
    const raw = process.env.TPCODE_WINDOWS_DRIVE_MAP?.trim()
    if (!raw) return new Map<string, string>()
    return new Map(
      raw
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .flatMap((item) => {
          const index = item.indexOf("=")
          if (index <= 0) return []
          const letter = item.slice(0, index).trim().replace(/:$/, "").toUpperCase()
          const target = item.slice(index + 1).trim()
          if (!/^[A-Z]$/.test(letter) || !target) return []
          return [[letter, target] as const]
        }),
    )
  }

  /** 中文注释：把任意输入规整成稳定路径字符串；UNC 路径保留原始共享语义，本地路径转绝对路径。 */
  export function stablePath(input: string) {
    const current = input.trim()
    if (!current) return current
    const unc = shared(current)
    if (unc) {
      return `\\\\${unc.server}\\${unc.share}${unc.rest.length > 0 ? `\\${unc.rest.join("\\")}` : ""}`
    }
    if (/^[a-zA-Z]:[\\/]/.test(current)) return windowsPath(current)
    return resolve(current)
  }

  /** 中文注释：把 UNC 共享路径映射到当前机器的挂载目录，默认使用 /Volumes，也支持测试时通过环境变量覆盖。 */
  export function sharedMountPath(input: string) {
    if (process.platform === "win32") return
    const unc = shared(input)
    if (!unc) return
    const root = process.env.TPCODE_SHARED_MOUNT_ROOT?.trim() || "/Volumes"
    return join(root, unc.share, ...unc.rest)
  }

  /** 中文注释：把 Windows 盘符路径映射到当前机器可访问的共享挂载目录，便于本地直连正式库复测。 */
  export function driveMountPath(input: string) {
    if (process.platform === "win32") return
    const current = drive(input)
    if (!current) return
    const target = driveMap().get(current.letter)
    if (!target) return
    const unc = shared(target)
    if (unc) {
      const next = `\\\\${unc.server}\\${unc.share}${[...unc.rest, ...current.rest].length > 0 ? `\\${[...unc.rest, ...current.rest].join("\\")}` : ""}`
      return sharedMountPath(next)
    }
    return join(target, ...current.rest)
  }

  /** 中文注释：返回当前机器真正可访问的本地路径，统一给文件系统读写和沙盒层复用。 */
  export function accessPath(input: string) {
    const current = input.trim()
    if (!current) return current
    return driveMountPath(current) ?? sharedMountPath(current) ?? stablePath(current)
  }

  /** 中文注释：跨平台获取目录或文件的末级名称，避免 UNC 路径在非 Windows 平台上 basename 失真。 */
  export function baseName(input: string) {
    const current = accessPath(input).replace(/[\\/]+$/, "")
    const parts = current.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? current
  }

  // Fast sync version for metadata checks
  export async function exists(p: string): Promise<boolean> {
    return existsSync(accessPath(p))
  }

  export async function isDir(p: string): Promise<boolean> {
    try {
      return statSync(accessPath(p)).isDirectory()
    } catch {
      return false
    }
  }

  export function stat(p: string): ReturnType<typeof statSync> | undefined {
    return statSync(accessPath(p), { throwIfNoEntry: false }) ?? undefined
  }

  export async function size(p: string): Promise<number> {
    const s = stat(p)?.size ?? 0
    return typeof s === "bigint" ? Number(s) : s
  }

  export async function readText(p: string): Promise<string> {
    return readFile(accessPath(p), "utf-8")
  }

  export async function readJson<T = any>(p: string): Promise<T> {
    return JSON.parse(await readFile(accessPath(p), "utf-8"))
  }

  export async function readBytes(p: string): Promise<Buffer> {
    return readFile(accessPath(p))
  }

  export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
    const buf = await readFile(accessPath(p))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  function isEnoent(e: unknown): e is { code: "ENOENT" } {
    return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
  }

  export async function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
    const target = accessPath(p)
    try {
      if (mode) {
        await writeFile(target, content, { mode })
      } else {
        await writeFile(target, content)
      }
    } catch (e) {
      if (isEnoent(e)) {
        await mkdir(dirname(target), { recursive: true })
        if (mode) {
          await writeFile(target, content, { mode })
        } else {
          await writeFile(target, content)
        }
        return
      }
      throw e
    }
  }

  export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
    return write(p, JSON.stringify(data, null, 2), mode)
  }

  export async function writeStream(
    p: string,
    stream: ReadableStream<Uint8Array> | Readable,
    mode?: number,
  ): Promise<void> {
    const target = accessPath(p)
    const dir = dirname(target)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as any) : stream
    const writeStream = createWriteStream(target)
    await pipeline(nodeStream, writeStream)

    if (mode) {
      await chmod(target, mode)
    }
  }

  export function mimeType(p: string): string {
    return lookup(p) || "application/octet-stream"
  }

  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    p = accessPath(p)
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  export function windowsPath(p: string): string {
    if (process.platform !== "win32") return p
    return (
      p
        // Git Bash for Windows paths are typically /<drive>/...
        .replace(/^\/([a-zA-Z])\//, (_, drive) => `${drive.toUpperCase()}:/`)
        // Cygwin git paths are typically /cygdrive/<drive>/...
        .replace(/^\/cygdrive\/([a-zA-Z])\//, (_, drive) => `${drive.toUpperCase()}:/`)
        // WSL paths are typically /mnt/<drive>/...
        .replace(/^\/mnt\/([a-zA-Z])\//, (_, drive) => `${drive.toUpperCase()}:/`)
    )
  }
  export function overlaps(a: string, b: string) {
    const relA = relative(accessPath(a), accessPath(b))
    const relB = relative(accessPath(b), accessPath(a))
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !relative(accessPath(parent), accessPath(child)).startsWith("..")
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = accessPath(start)
    const end = stop ? accessPath(stop) : undefined
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = accessPath(start)
    const end = stop ? accessPath(stop) : undefined
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = accessPath(start)
    const end = stop ? accessPath(stop) : undefined
    const result = []
    while (true) {
      try {
        const matches = await Glob.scan(pattern, {
          cwd: current,
          absolute: true,
          include: "file",
          dot: true,
        })
        result.push(...matches)
      } catch {
        // Skip invalid glob patterns
      }
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
