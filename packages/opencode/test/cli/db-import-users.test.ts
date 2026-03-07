import { expect, test } from "bun:test"
import { parseCsv, parseImportUsersCsv } from "../../src/cli/cmd/db-import-users"

test("parseCsv handles quoted commas and escaped quotes", () => {
  const rows = parseCsv('USER_ID,NAME\n1,"张三, ""研发"""')
  expect(rows).toEqual([
    ["USER_ID", "NAME"],
    ["1", '张三, "研发"'],
  ])
})

test("parseImportUsersCsv maps employee export aliases", () => {
  const rows = parseImportUsersCsv(
    [
      "USER_ID,USER_NAME,PASSWORD,PLAINTEXT_PASSWORD,姓名,手机号,XSBZ",
      "u_1,13800138000,5d247c0bb4d1be77,0123456789abcdef0123456789abcdef,张三,13800138000,0",
    ].join("\n"),
  )
  expect(rows).toEqual([
    {
      user_id: "u_1",
      username: "13800138000",
      password_hash: "5d247c0bb4d1be77",
      password_salt: "0123456789abcdef0123456789abcdef",
      display_name: "张三",
      phone: "13800138000",
      status: "0",
    },
  ])
})

test("parseImportUsersCsv maps current employee SQL export", () => {
  const rows = parseImportUsersCsv(
    [
      "USER_ID,USER_NAME,PASSWORD_HASH,PASSWORD_SALT,ACCOUNT_STATUS,PWD_TIME",
      "13000000000,张三,5d247c0bb4d1be77,0123456789abcdef0123456789abcdef,0,2026-03-07 09:00:00",
    ].join("\n"),
  )
  expect(rows).toEqual([
    {
      user_id: "13000000000",
      username: "13000000000",
      password_hash: "5d247c0bb4d1be77",
      password_salt: "0123456789abcdef0123456789abcdef",
      display_name: "张三",
      phone: undefined,
      status: "0",
    },
  ])
})

test("parseImportUsersCsv skips blank rows", () => {
  const rows = parseImportUsersCsv(["USER_ID,USER_NAME,PASSWORD,PLAINTEXT_PASSWORD", "", ",,,", "u_2,user2,aaaa,bbbb"].join("\n"))
  expect(rows).toEqual([
    {
      user_id: "u_2",
      username: "u_2",
      password_hash: "aaaa",
      password_salt: "bbbb",
      display_name: "user2",
      phone: undefined,
      status: undefined,
    },
  ])
})
