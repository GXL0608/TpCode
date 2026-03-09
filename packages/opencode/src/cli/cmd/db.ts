import type { Argv } from "yargs"
import { Database } from "../../storage/db"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import { ImportUsersCommand } from "./db-import-users"
import { ImportUserAffiliationCommand } from "./db-import-user-affiliation"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "run a PostgreSQL query",
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
    if (!query) {
      UI.error("Interactive shell is not available in PostgreSQL mode. Please pass a SQL query.")
      process.exit(1)
    }
    try {
      const result = (await Database.raw(query)) as Record<string, unknown>[]
      if (args.format === "json") {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      if (result.length === 0) return
      const keys = Object.keys(result[0])
      console.log(keys.join("\t"))
      for (const row of result) {
        console.log(keys.map((k) => row[k]).join("\t"))
      }
    } catch (err) {
      UI.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print PostgreSQL connection info",
  handler: () => {
    const remote = Database.masked()
    if (remote) {
      console.log(remote)
      return
    }
    UI.error("PostgreSQL url is not configured. Set OPENCODE_DATABASE_URL or OPENCODE_PG_URL.")
    process.exit(1)
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "apply PostgreSQL migrations",
  handler: async () => {
    try {
      await Database.Client()
      UI.println("Migrations complete")
    } catch (err) {
      UI.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  },
})

const VerifyCommand = cmd({
  command: "verify",
  describe: "verify PostgreSQL connectivity and table counts",
  handler: async () => {
    const rows = (await Database.raw(
      "select table_name from information_schema.tables where table_schema = current_schema() and table_name <> 'opencode_migration' and table_name not like '__drizzle%' order by table_name",
    )) as { table_name: string }[]
    for (const row of rows) {
      const escaped = row.table_name.replaceAll('"', '""')
      const count = (await Database.raw(`select count(*) as c from "${escaped}"`)) as { c: number | string }[]
      UI.println(`${row.table_name}\trows=${count[0]?.c ?? 0}`)
    }
    UI.println(`Verified tables: ${rows.length}`)
  },
})

function mark() {
  return new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace("T", "-").slice(0, 15)
}

const BackupCommand = cmd({
  command: "backup [dir]",
  describe: "backup PostgreSQL data as json files",
  builder: (yargs: Argv) => {
    return yargs.positional("dir", {
      type: "string",
      describe: "backup directory (default: ./opencode-backup/<timestamp>)",
    })
  },
  handler: async (args) => {
    const dir = args.dir ? path.resolve(String(args.dir)) : path.join(process.cwd(), "opencode-backup", mark())
    mkdirSync(dir, { recursive: true })

    const tables = (await Database.raw(
      "select table_name from information_schema.tables where table_schema = current_schema() and table_name <> 'opencode_migration' and table_name not like '__drizzle%' order by table_name",
    )) as { table_name: string }[]
    const counts: Record<string, number> = {}
    for (const row of tables) {
      const table = row.table_name
      const escaped = table.replaceAll('"', '""')
      const rows = (await Database.raw(`select * from "${escaped}"`)) as Record<string, unknown>[]
      counts[table] = rows.length
      writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2))
    }

    const meta = {
      time: new Date().toISOString(),
      postgres: Database.masked(),
      tables: counts,
    }
    writeFileSync(path.join(dir, "backup.json"), JSON.stringify(meta, null, 2))

    UI.println(`Backup complete: ${dir}`)
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
      .command(VerifyCommand)
      .command(BackupCommand)
      .command(ImportUsersCommand)
      .command(ImportUserAffiliationCommand)
      .demandCommand()
  },
  handler: () => {},
})
