import { expect, test } from "bun:test"
import { parseImportUserAffiliationCsv } from "../../src/cli/cmd/db-import-user-affiliation"

test("parseImportUserAffiliationCsv maps the exact affiliation header", () => {
  const rows = parseImportUserAffiliationCsv(
    [
      "\uFEFFusername,customerId,customerName,departmentId,departmentName",
      "u_1,c_1,客户一,08,客户中心",
    ].join("\n"),
  )
  expect(rows).toEqual([
    {
      username: "u_1",
      customer_id: "c_1",
      customer_name: "客户一",
      customer_department_id: "08",
      customer_department_name: "客户中心",
    },
  ])
})

test("parseImportUserAffiliationCsv keeps empty affiliation cells optional and skips blank rows", () => {
  const rows = parseImportUserAffiliationCsv(
    [
      "username,customerId,customerName,departmentId,departmentName",
      "",
      ",,,,",
      "u_2, ,客户二, , ",
    ].join("\n"),
  )
  expect(rows).toEqual([
    {
      username: "u_2",
      customer_id: undefined,
      customer_name: "客户二",
      customer_department_id: undefined,
      customer_department_name: undefined,
    },
  ])
})

test("parseImportUserAffiliationCsv rejects unexpected headers", () => {
  expect(() => parseImportUserAffiliationCsv(["username,customerId,departmentId", "u_1,c_1,08"].join("\n"))).toThrow(
    "Invalid CSV header",
  )
})
