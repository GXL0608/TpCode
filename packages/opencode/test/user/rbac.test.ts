import { expect, test } from "bun:test"
import { UserRbac } from "../../src/user/rbac"

test("super_admin 在缺少显式 build 权限码时仍具备 build 能力", () => {
  expect(UserRbac.canUseBuild({ roles: ["super_admin"], permissions: [] })).toBe(true)
  expect(UserRbac.canUseBuild({ roles: ["developer"], permissions: ["agent:use_build"] })).toBe(true)
  expect(UserRbac.canUseBuild({ roles: ["developer"], permissions: [] })).toBe(false)
})
