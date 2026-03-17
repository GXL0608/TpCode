import { describe, expect, test } from "bun:test"
import { normalizeServerUrl, resolveDefaultServerUrl } from "./default-server-url"

describe("default server url", () => {
  test("normalizes url values", () => {
    expect(normalizeServerUrl(" https://tpcode.xxx/// ")).toBe("https://tpcode.xxx")
    expect(normalizeServerUrl("")).toBeUndefined()
    expect(normalizeServerUrl("   ")).toBeUndefined()
  })

  test("prefers runtime gateway url over stored default", () => {
    expect(
      resolveDefaultServerUrl({
        runtime: "https://tpcode.xxx",
        stored: "http://127.0.0.1:4096",
        hostname: "node-01.local",
        origin: "http://node-01.local:4096",
        dev: false,
      }),
    ).toBe("https://tpcode.xxx")
  })

  test("uses stored default when runtime is absent", () => {
    expect(
      resolveDefaultServerUrl({
        stored: "http://127.0.0.1:4096/",
        hostname: "node-01.local",
        origin: "http://node-01.local:4096",
        dev: false,
      }),
    ).toBe("http://127.0.0.1:4096")
  })

  test("prefers explicit dev host and port over stored default in dev mode", () => {
    expect(
      resolveDefaultServerUrl({
        stored: "https://www.tphy.com.cn:9149",
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:3008",
        dev: true,
        devHost: "127.0.0.1",
        devPort: "4108",
      }),
    ).toBe("http://127.0.0.1:4108")
  })

  test("uses localhost when host is opencode.ai", () => {
    expect(
      resolveDefaultServerUrl({
        hostname: "tpcode.opencode.ai",
        origin: "https://tpcode.opencode.ai",
        dev: false,
      }),
    ).toBe("http://localhost:4096")
  })

  test("uses dev host and port in dev mode", () => {
    expect(
      resolveDefaultServerUrl({
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:5173",
        dev: true,
        devHost: "127.0.0.1",
        devPort: "4098",
      }),
    ).toBe("http://127.0.0.1:4098")
  })

  test("derives the paired local backend port from the current dev origin when explicit config is absent", () => {
    expect(
      resolveDefaultServerUrl({
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:3008",
        dev: true,
      }),
    ).toBe("http://127.0.0.1:4108")
  })

  test("falls back to origin in production", () => {
    expect(
      resolveDefaultServerUrl({
        hostname: "node-01.local",
        origin: "http://node-01.local:4096",
        dev: false,
      }),
    ).toBe("http://node-01.local:4096")
  })
})
