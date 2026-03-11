import { Spool } from "./spool"
import { Writer } from "./writer"
import type { LogEvent } from "./schema"

export namespace Replay {
  export function create(input: {
    spool?: ReturnType<typeof Spool.create>
    writer: Pick<ReturnType<typeof Writer.create>, "flush">
    report?: (event: LogEvent) => Promise<void>
  }) {
    const spool = input.spool ?? Spool.create()

    return {
      async run(limit = 10) {
        const files = (await spool.list()).slice(0, limit)
        for (const file of files) {
          const batch = await spool.read(file)
          if (!batch.length) {
            await spool.remove(file)
            continue
          }
          const ok = await input.writer.flush(batch, { spool: false })
          if (ok) {
            await input.report?.({
              created_at: new Date().toISOString(),
              level: "INFO",
              service: "log",
              event: "log.spool.replay",
              message: "spool replay",
              status: "completed",
              count: 1,
              tags: {},
              extra: {
                file,
                batch_size: batch.length,
              },
            })
            await spool.remove(file)
          }
        }
      },
    }
  }
}
