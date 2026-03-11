import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import type { LogEvent } from "./schema"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export namespace Spool {
  export function create(input?: { dir?: string; now?: () => number }) {
    const dir = input?.dir ?? path.join(Global.Path.log, "spool")
    const now = input?.now ?? Date.now

    return {
      dir,
      async write(batch: LogEvent[]) {
        if (!batch.length) return ""
        const file = path.join(dir, `${now()}-${randomUUID()}.jsonl`)
        await Filesystem.write(
          file,
          batch
            .map((item) => JSON.stringify(item))
            .join("\n")
            .concat("\n"),
        )
        return file
      },
      async list() {
        const items = await fs.readdir(dir).catch(() => [])
        return items
          .filter((item) => item.endsWith(".jsonl"))
          .sort()
          .map((item) => path.join(dir, item))
      },
      async read(file: string) {
        const text = await Bun.file(file).text().catch(() => "")
        return text
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => JSON.parse(item) as LogEvent)
      },
      async remove(file: string) {
        await fs.unlink(file).catch(() => {})
      },
    }
  }
}
