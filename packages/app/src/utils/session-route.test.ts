import { describe, expect, test } from "bun:test"
import { freshSessionHref, isFreshSessionSearch, sessionHref } from "./session-route"

describe("session-route", () => {
  test("为产品入口生成可恢复最近会话的普通路由", () => {
    expect(sessionHref("L2RlbW8")).toBe("/L2RlbW8/session")
    expect(sessionHref("L2RlbW8", "prod_1")).toBe("/L2RlbW8/session?product=prod_1")
  })

  test("为显式新会话生成带 fresh 标记的路由", () => {
    expect(freshSessionHref("L2RlbW8")).toBe("/L2RlbW8/session?fresh=1")
  })

  test("共享目录产品切换时保留产品标识，避免路由字符串不变", () => {
    expect(freshSessionHref("L2RlbW8", "prod_1")).toBe("/L2RlbW8/session?fresh=1&product=prod_1")
  })

  test("识别显式新会话路由查询参数", () => {
    expect(isFreshSessionSearch("?fresh=1")).toBe(true)
    expect(isFreshSessionSearch("?a=1&fresh=1")).toBe(true)
    expect(isFreshSessionSearch("")).toBe(false)
    expect(isFreshSessionSearch("?fresh=0")).toBe(false)
  })
})
