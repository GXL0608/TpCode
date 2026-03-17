import { describe, expect, test } from "bun:test"
import { freshSessionHref, isFreshSessionSearch } from "./session-route"

describe("session-route", () => {
  test("为显式新会话生成带 fresh 标记的路由", () => {
    expect(freshSessionHref("L2RlbW8")).toBe("/L2RlbW8/session?fresh=1")
  })

  test("识别显式新会话路由查询参数", () => {
    expect(isFreshSessionSearch("?fresh=1")).toBe(true)
    expect(isFreshSessionSearch("?a=1&fresh=1")).toBe(true)
    expect(isFreshSessionSearch("")).toBe(false)
    expect(isFreshSessionSearch("?fresh=0")).toBe(false)
  })
})
