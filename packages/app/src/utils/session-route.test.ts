import { describe, expect, test } from "bun:test"
import { freshSessionContextHref, freshSessionHref, isFreshSessionSearch, sessionHref, sessionProductID } from "./session-route"

describe("session-route", () => {
  test("为产品入口生成可恢复最近会话的普通路由", () => {
    expect(sessionHref("L2RlbW8")).toBe("/L2RlbW8/session")
    expect(sessionHref("L2RlbW8", "prod_1")).toBe("/L2RlbW8/session?product=prod_1")
  })

  test("为显式新会话生成带 fresh 标记的路由", () => {
    expect(freshSessionHref("L2RlbW8")).toBe("/L2RlbW8/session?fresh=1")
  })

  test("显式新建会话时允许附带 fresh_key，确保同页再次新建也能触发重置", () => {
    expect(freshSessionHref("L2RlbW8", "prod_1", "fresh_123")).toBe(
      "/L2RlbW8/session?fresh=1&fresh_key=fresh_123&product=prod_1",
    )
  })

  test("共享目录产品切换时保留产品标识，避免路由字符串不变", () => {
    expect(freshSessionHref("L2RlbW8", "prod_1")).toBe("/L2RlbW8/session?fresh=1&product=prod_1")
  })

  test("产品模式新建会话时优先保留当前路由里的产品标识", () => {
    expect(
      freshSessionContextHref({
        directory: "L2RlbW8",
        search: "?fresh=1&product=prod_1",
        fallback_product_id: "prod_fallback",
        fresh_key: "fresh_123",
      }),
    ).toBe("/L2RlbW8/session?fresh=1&fresh_key=fresh_123&product=prod_1")
  })

  test("当前路由没有产品标识时回退登录上下文产品", () => {
    expect(sessionProductID("", "prod_fallback")).toBe("prod_fallback")
    expect(
      freshSessionContextHref({
        directory: "L2RlbW8",
        search: "",
        fallback_product_id: "prod_fallback",
        fresh_key: "fresh_123",
      }),
    ).toBe("/L2RlbW8/session?fresh=1&fresh_key=fresh_123&product=prod_fallback")
  })

  test("识别显式新会话路由查询参数", () => {
    expect(isFreshSessionSearch("?fresh=1")).toBe(true)
    expect(isFreshSessionSearch("?a=1&fresh=1")).toBe(true)
    expect(isFreshSessionSearch("")).toBe(false)
    expect(isFreshSessionSearch("?fresh=0")).toBe(false)
  })
})
