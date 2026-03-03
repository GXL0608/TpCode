import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "../../storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { JsonMigration } from "../../storage/json-migration"
import { EOL } from "os"
import { PgSync } from "../../storage/pg-sync"
import { existsSync } from "fs"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.Path], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
    const remote = PgSync.masked()
    if (remote) {
      console.log(remote)
    }
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "migrate JSON data to SQLite (merges with existing data)",
  handler: async () => {
    const sqlite = new BunDatabase(Database.Path)
    const tty = process.stderr.isTTY
    const width = 36
    const orange = "\x1b[38;5;214m"
    const muted = "\x1b[0;2m"
    const reset = "\x1b[0m"
    let last = -1
    if (tty) process.stderr.write("\x1b[?25l")
    try {
      const stats = await JsonMigration.run(sqlite, {
        progress: (event) => {
          const percent = Math.floor((event.current / event.total) * 100)
          if (percent === last) return
          last = percent
          if (tty) {
            const fill = Math.round((percent / 100) * width)
            const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
            process.stderr.write(
              `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.current}/${event.total}${reset} `,
            )
          } else {
            process.stderr.write(`sqlite-migration:${percent}${EOL}`)
          }
        },
      })
      if (tty) process.stderr.write("\n")
      if (tty) process.stderr.write("\x1b[?25h")
      else process.stderr.write(`sqlite-migration:done${EOL}`)
      UI.println(
        `Migration complete: ${stats.projects} projects, ${stats.sessions} sessions, ${stats.messages} messages`,
      )
      if (stats.errors.length > 0) {
        UI.println(`${stats.errors.length} errors occurred during migration`)
      }
    } catch (err) {
      if (tty) process.stderr.write("\x1b[?25h")
      UI.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    } finally {
      sqlite.close()
    }
  },
})

const SyncCommand = cmd({
  command: "sync",
  describe: "sync SQLite data to PostgreSQL",
  handler: async () => {
    if (!PgSync.enabled()) {
      UI.error("PostgreSQL sync is disabled. Set OPENCODE_DATABASE_URL or OPENCODE_PG_URL.")
      process.exit(1)
    }

    await PgSync.start()
    await PgSync.flush(true)
    const result = await PgSync.verify()
    if (!result.enabled) {
      UI.error("PostgreSQL sync is disabled")
      process.exit(1)
    }

    const mismatch = result.tables.filter((item) => item.sqlite !== item.pgsql)
    if (mismatch.length > 0) {
      UI.error("Sync completed with mismatched row counts")
      for (const item of mismatch) {
        UI.println(`${item.table}: sqlite=${item.sqlite} pgsql=${item.pgsql}`)
      }
      process.exit(1)
    }

    UI.println(`Sync complete: ${result.tables.length} tables`)
  },
})

const VerifyCommand = cmd({
  command: "verify",
  describe: "verify SQLite and PostgreSQL row counts",
  handler: async () => {
    const result = await PgSync.verify()
    if (!result.enabled) {
      UI.error("PostgreSQL sync is disabled. Set OPENCODE_DATABASE_URL or OPENCODE_PG_URL.")
      process.exit(1)
    }

    for (const item of result.tables) {
      UI.println(`${item.table}\tsqlite=${item.sqlite}\tpgsql=${item.pgsql}`)
    }

    if (!result.same) {
      UI.error("Row count mismatch detected")
      process.exit(1)
    }
  },
})

const ImportCommand = cmd({
  command: "import <sqlitePath>",
  describe: "merge data from an existing SQLite database into PostgreSQL",
  builder: (yargs: Argv) => {
    return yargs.positional("sqlitePath", {
      type: "string",
      describe: "path to source sqlite database file",
      demandOption: true,
    })
  },
  handler: async (args) => {
    if (!PgSync.enabled()) {
      UI.error("PostgreSQL sync is disabled. Set OPENCODE_DATABASE_URL or OPENCODE_PG_URL.")
      process.exit(1)
    }

    const sqlitePath = String(args.sqlitePath)
    if (!existsSync(sqlitePath)) {
      UI.error(`SQLite file not found: ${sqlitePath}`)
      process.exit(1)
    }

    await PgSync.importFrom(sqlitePath)
    UI.println(`Import complete: ${sqlitePath}`)
  },
})

const ReplaceCommand = cmd({
  command: "replace <sqlitePath>",
  describe: "replace PostgreSQL data with the specified SQLite database",
  builder: (yargs: Argv) => {
    return yargs.positional("sqlitePath", {
      type: "string",
      describe: "path to source sqlite database file",
      demandOption: true,
    })
  },
  handler: async (args) => {
    if (!PgSync.enabled()) {
      UI.error("PostgreSQL sync is disabled. Set OPENCODE_DATABASE_URL or OPENCODE_PG_URL.")
      process.exit(1)
    }

    const sqlitePath = String(args.sqlitePath)
    if (!existsSync(sqlitePath)) {
      UI.error(`SQLite file not found: ${sqlitePath}`)
      process.exit(1)
    }

    await PgSync.replaceFrom(sqlitePath)
    UI.println(`Replace complete: ${sqlitePath}`)
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(MigrateCommand)
      .command(SyncCommand)
      .command(VerifyCommand)
      .command(ImportCommand)
      .command(ReplaceCommand)
      .demandCommand()
  },
  handler: () => {},
})
