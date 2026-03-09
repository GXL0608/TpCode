import type { Argv } from "yargs"
import path from "path"
import { UserService } from "../../user/service"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { parseCsv } from "./db-import-users"

const head = ["username", "customerId", "customerName", "departmentId", "departmentName"] as const

function key(input: string) {
  return input.replace(/^\uFEFF/, "").trim()
}

function text(input?: string) {
  const value = input?.trim()
  if (!value) return
  return value
}

export function parseImportUserAffiliationCsv(input: string) {
  const rows = parseCsv(input)
  if (rows.length === 0) {
    return [] as {
      username: string
      customer_id?: string
      customer_name?: string
      customer_department_id?: string
      customer_department_name?: string
    }[]
  }
  const keys = rows[0]?.map(key) ?? []
  if (keys.length !== head.length || keys.some((item, index) => item !== head[index])) {
    throw new Error(`Invalid CSV header, expected: ${head.join(",")}`)
  }
  return rows.slice(1).flatMap((cols, index) => {
    if (!cols.some((item) => item.trim())) return []
    if (cols.length !== head.length) {
      throw new Error(`Invalid CSV row ${index + 2}, expected ${head.length} columns`)
    }
    return [
      {
        username: cols[0]?.trim() ?? "",
        customer_id: text(cols[1]),
        customer_name: text(cols[2]),
        customer_department_id: text(cols[3]),
        customer_department_name: text(cols[4]),
      },
    ]
  })
}

export const ImportUserAffiliationCommand = cmd({
  command: "import-user-affiliation <file>",
  describe: "import customer and department affiliation for existing users from CSV",
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "CSV file with username, customer and department columns",
        demandOption: true,
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "validate and count updates without writing to the database",
      }),
  handler: async (args) => {
    const file = path.resolve(String(args.file))
    const text = await Bun.file(file).text().catch(() => undefined)
    if (text === undefined) {
      UI.error(`File not found: ${file}`)
      process.exit(1)
    }
    let rows: ReturnType<typeof parseImportUserAffiliationCsv>
    try {
      rows = parseImportUserAffiliationCsv(text)
    } catch (err) {
      UI.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
    if (rows.length === 0) {
      UI.error("No import rows found in CSV")
      process.exit(1)
    }
    const dry_run = !!args["dry-run"]
    const result = await UserService.importUserAffiliations({
      rows,
      dry_run,
    })
    const label = result.dry_run ? "Dry run complete" : "Import complete"
    UI.println(
      `${label}: updated=${result.updated} unchanged=${result.unchanged} missing_user=${result.missing_user} skipped=${result.skipped}`,
    )
  },
})
