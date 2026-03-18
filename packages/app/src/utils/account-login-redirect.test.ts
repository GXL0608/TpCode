import { describe, expect, test } from "bun:test"
import { loginRedirectHref, loginSuccessHref } from "./account-login-redirect"

describe("account-login-redirect", () => {
  test("未登录访问深链接时保留完整返回地址", () => {
    expect(loginRedirectHref("/L2RlbW8/session", "?fresh=1&product=prod_1")).toBe(
      "/login?redirect=%2FL2RlbW8%2Fsession%3Ffresh%3D1%26product%3Dprod_1",
    )
  })

  test("登录成功后恢复到原始深链接", () => {
    expect(loginSuccessHref("?redirect=%2FL2RlbW8%2Fsession%3Ffresh%3D1%26product%3Dprod_1")).toBe(
      "/L2RlbW8/session?fresh=1&product=prod_1",
    )
  })

  test("非法返回地址回退首页，避免开放跳转", () => {
    expect(loginSuccessHref("?redirect=https%3A%2F%2Fevil.example")).toBe("/")
    expect(loginSuccessHref("?redirect=%2F%2Fevil.example")).toBe("/")
  })
})
