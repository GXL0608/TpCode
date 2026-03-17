import { glob, globSync, type GlobOptions } from "glob"
import { minimatch } from "minimatch"

export namespace Glob {
  export interface Options {
    cwd?: string
    absolute?: boolean
    include?: "file" | "all"
    dot?: boolean
    symlink?: boolean
  }

  function toGlobOptions(options: Options): GlobOptions {
    return {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      follow: options.symlink ?? false,
      nodir: options.include !== "all",
    }
  }

  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    return glob(pattern, toGlobOptions(options)) as Promise<string[]>
  }

  export function scanSync(pattern: string, options: Options = {}): string[] {
    return globSync(pattern, toGlobOptions(options)) as string[]
  }

  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }

  /** 中文注释：提取 glob 模式中第一个通配符之前的静态目录前缀，供大目录扫描时缩小起始范围。 */
  export function prefix(pattern: string): string {
    const parts = pattern.replaceAll("\\", "/").split("/")
    const prefix = [] as string[]
    for (const part of parts) {
      if (!part || part === ".") continue
      if (/[*?[{\]()!+@]/.test(part)) break
      prefix.push(part)
    }
    return prefix.join("/")
  }
}
