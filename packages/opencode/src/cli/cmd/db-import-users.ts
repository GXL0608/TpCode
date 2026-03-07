import type { Argv } from "yargs"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { UserService } from "../../user/service"

function key(input: string) {
  return input.replace(/^\uFEFF/, "").trim().toLowerCase()
}

function pick(row: Record<string, string>, names: string[]) {
  return names.map((name) => row[key(name)]?.trim()).find(Boolean)
}

export function parseCsv(input: string) {
  const rows = [] as string[][]
  let row = [] as string[]
  let cell = ""
  let quote = false
  const text = input.replace(/\r/g, "")
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ""
    if (quote) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
          continue
        }
        quote = false
        continue
      }
      cell += char
      continue
    }
    if (char === '"') {
      quote = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell)
      cell = ""
      if (row.some((item) => item.trim())) rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  if (cell || row.length > 0) {
    row.push(cell)
    if (row.some((item) => item.trim())) rows.push(row)
  }
  return rows
}

export function parseImportUsersCsv(input: string) {
  const rows = parseCsv(input)
  if (rows.length === 0) return [] as {
    user_id: string
    username: string
    password_hash: string
    password_salt: string
    display_name?: string
    phone?: string
    status?: string
  }[]
  const head = rows[0]?.map(key) ?? []
  return rows.slice(1).flatMap((cols) => {
    const row = Object.fromEntries(head.map((name, index) => [name, cols[index] ?? ""]))
    const user_id = pick(row, ["VHO_USER_ID", "EMPLOYEE_ID", "工号", "员工ID", "员工号", "USER_ID", "ID"]) ?? ""
    const username = pick(row, ["USERNAME", "ACCOUNT", "LOGIN_NAME", "PHONE", "账号", "登录账号", "用户名", "手机号"]) ?? user_id
    const password_hash = pick(row, ["PASSWORD", "PASSWORD_HASH", "密码", "密码哈希"]) ?? ""
    const password_salt = pick(row, ["PLAINTEXT_PASSWORD", "SALT", "PASSWORD_SALT", "密码盐", "SALT_HEX"]) ?? ""
    const display_name = pick(row, ["NAME", "DISPLAY_NAME", "REAL_NAME", "FULL_NAME", "姓名", "USER_NAME"])
    const phone = pick(row, ["PHONE", "MOBILE", "MOBILE_PHONE", "CELLPHONE", "手机号", "手机"])
    const status = pick(row, ["XSBZ", "ACCOUNT_STATUS", "STATUS", "STATE", "ACTIVE", "状态"])
    if (!username && !user_id && !password_hash && !password_salt && !display_name && !phone && !status) return []
    return [
      {
        user_id,
        username,
        password_hash,
        password_salt,
        display_name,
        phone,
        status,
      },
    ]
  })
}

export const ImportUsersCommand = cmd({
  command: "import-users <file>",
  describe: "import VHO employee users from CSV",
  builder: (yargs: Argv) =>
    yargs.positional("file", {
      type: "string",
      describe: "CSV file exported from VHO employee system",
      demandOption: true,
    }),
  handler: async (args) => {
    const file = path.resolve(String(args.file))
    const text = await Bun.file(file).text().catch(() => undefined)
    if (text === undefined) {
      UI.error(`File not found: ${file}`)
      process.exit(1)
    }
    const rows = parseImportUsersCsv(text)
    if (rows.length === 0) {
      UI.error("No import rows found in CSV")
      process.exit(1)
    }
    const result = await UserService.importVhoUsers({ rows })
    if (!result.ok) {
      UI.error(`Import failed: ${result.code}`)
      process.exit(1)
    }
    UI.println(
      `Import complete: created=${result.created} updated=${result.updated} conflict=${result.conflict} invalid_password=${result.invalid_password} invalid_phone=${result.invalid_phone} skipped=${result.skipped}`,
    )
  },
})
