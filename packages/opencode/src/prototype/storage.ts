import { Filesystem } from "@/util/filesystem"
import path from "path"
import { readdir, rm, rmdir } from "fs/promises"

function safe(input: string) {
  const value = input.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  return value || "page"
}

export namespace PrototypeStorage {
  async function prune(dir: string, stop: string) {
    let current = dir
    while (current !== stop) {
      if (!(await Filesystem.exists(current))) return
      const items = await readdir(current)
      if (items.length) return
      await rmdir(current)
      const parent = path.dirname(current)
      if (parent === current) return
      current = parent
    }
  }

  export function key(input: {
    directory: string
    session_id: string
    page_key: string
    version: number
    extension: string
  }) {
    return path.join(
      input.directory,
      ".opencode",
      "prototypes",
      input.session_id,
      safe(input.page_key),
      `v${input.version}.${input.extension}`,
    )
  }

  export async function put(input: { key: string; bytes: Uint8Array | Buffer }) {
    await Filesystem.write(input.key, Buffer.from(input.bytes))
    return input.key
  }

  export async function read(input: { key: string }) {
    const file = Bun.file(input.key)
    if (!(await file.exists())) return
    return file
  }

  export async function remove(input: { key: string }) {
    await rm(input.key, { force: true })
    await prune(path.dirname(input.key), path.dirname(path.dirname(path.dirname(input.key))))
  }
}
