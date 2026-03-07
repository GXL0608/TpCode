import { describe, expect, test } from "bun:test"
import { normalizeWebURL, resolveWebGateway, webGatewayBootstrap } from "../../src/server/web-gateway"

describe("server/web-gateway", () => {
  test("normalizes gateway web url", () => {
    expect(normalizeWebURL(" https://tpcode.xxx/// ")).toBe("https://tpcode.xxx")
    expect(normalizeWebURL("")).toBeUndefined()
    expect(normalizeWebURL("   ")).toBeUndefined()
  })

  test("resolves enabled gateway web with url", () => {
    expect(
      resolveWebGateway({
        enabled: true,
        url: "https://tpcode.xxx///",
        defaultEnabled: false,
      }),
    ).toEqual({
      enabled: true,
      url: "https://tpcode.xxx",
    })
  })

  test("throws when gateway web enabled but url is missing", () => {
    expect(() =>
      resolveWebGateway({
        enabled: true,
        defaultEnabled: false,
      }),
    ).toThrow("Gateway web is enabled but webUrl is missing")
  })

  test("ignores url when gateway web disabled", () => {
    expect(
      resolveWebGateway({
        enabled: false,
        url: "https://tpcode.xxx",
        defaultEnabled: true,
      }),
    ).toEqual({
      enabled: false,
      url: undefined,
    })
  })

  test("uses defaults when enabled flag not set", () => {
    expect(
      resolveWebGateway({
        url: "https://tpcode.xxx",
        defaultEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      url: "https://tpcode.xxx",
    })
    expect(
      resolveWebGateway({
        defaultEnabled: false,
      }),
    ).toEqual({
      enabled: false,
      url: undefined,
    })
  })

  test("generates bootstrap when enabled", () => {
    expect(
      webGatewayBootstrap({
        enabled: true,
        url: "https://tpcode.xxx",
      }),
    ).toContain('<meta name="opencode-server-url" content="https://tpcode.xxx" />')
    expect(
      webGatewayBootstrap({
        enabled: false,
        url: "https://tpcode.xxx",
      }),
    ).toBeUndefined()
  })
})
