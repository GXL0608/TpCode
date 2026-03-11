import type { LogEvent, LogLevel } from "./schema"

const rank: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

export namespace Queue {
  export function create(input?: { limit?: number; now?: () => string }) {
    const list: LogEvent[] = []
    const dropped: Partial<Record<LogLevel, number>> = {}
    const limit = input?.limit ?? 5000
    const now = input?.now ?? (() => new Date().toISOString())

    function drop(level: LogLevel) {
      dropped[level] = (dropped[level] ?? 0) + 1
    }

    return {
      size() {
        return list.length
      },
      push(event: LogEvent) {
        if (list.length < limit) {
          list.push(event)
          return true
        }

        if (rank[event.level] <= rank.INFO) {
          drop(event.level)
          return false
        }

        const index = list.findIndex((item) => rank[item.level] < rank[event.level])
        if (index < 0) {
          drop(event.level)
          return false
        }

        drop(list[index].level)
        list.splice(index, 1)
        list.push(event)
        return true
      },
      take(size: number) {
        if (size <= 0) return []
        return list.splice(0, size)
      },
      summary(service = "log") {
        const body = Object.fromEntries(Object.entries(dropped).filter((item) => item[1] && item[1] > 0))
        if (!Object.keys(body).length) return
        for (const key of Object.keys(dropped) as LogLevel[]) {
          delete dropped[key]
        }
        return {
          created_at: now(),
          level: "WARN" as const,
          service,
          event: "log.drop.summary",
          message: "log drop summary",
          status: "dropped" as const,
          count: 1,
          tags: {},
          extra: {
            dropped: body,
          },
        }
      },
    }
  }
}
