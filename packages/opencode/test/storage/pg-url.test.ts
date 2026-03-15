import { describe, expect, test } from "bun:test"
import { pgDefault, pgLocalDefault, pgSource, pgUrl } from "../../src/storage/pg-url"

describe("storage.pg-url", () => {
  test("uses opencode_dev for local default", () => {
    expect(pgDefault(true)).toBe("postgres://opencode:opencode@182.92.74.187:9124/opencode_dev")
  })

  test("uses opencode for packaged default", () => {
    expect(pgDefault(false)).toBe("postgres://opencode:opencode@182.92.74.187:9124/opencode")
  })

  test("prefers OPENCODE_DATABASE_URL over all defaults", () => {
    const env = {
      OPENCODE_DATABASE_URL: "postgres://a:b@127.0.0.1:5432/custom",
      OPENCODE_PG_URL: "postgres://a:b@127.0.0.1:5432/other",
    }
    expect(pgUrl(env, true)).toBe("postgres://a:b@127.0.0.1:5432/custom")
    expect(pgSource(env, true)).toBe("OPENCODE_DATABASE_URL")
  })

  test("uses OPENCODE_PG_URL when OPENCODE_DATABASE_URL is missing", () => {
    const env = {
      OPENCODE_PG_URL: "postgres://a:b@127.0.0.1:5432/legacy",
    }
    expect(pgUrl(env, false)).toBe("postgres://a:b@127.0.0.1:5432/legacy")
    expect(pgSource(env, false)).toBe("OPENCODE_PG_URL")
  })

  test("marks local fallback source when no env is set", () => {
    expect(pgSource({}, true)).toBe("DEFAULT_SEED_LOCAL")
  })

  test("marks packaged fallback source when no env is set", () => {
    expect(pgSource({}, false)).toBe("DEFAULT_SEED_PACKAGED")
  })

  test("uses packaged fallback for local channel binaries", () => {
    expect(
      pgLocalDefault({
        channel: "local",
        execPath: "C:\\Program Files\\TpCode\\opencode.exe",
      }),
    ).toBe(false)
  })

  test("keeps local fallback for source bun runtime", () => {
    expect(
      pgLocalDefault({
        channel: "local",
        execPath: "C:\\Users\\demo\\scoop\\apps\\bun\\current\\bun.exe",
      }),
    ).toBe(true)
  })

  test("uses packaged fallback outside local channel", () => {
    expect(
      pgLocalDefault({
        channel: "latest",
        execPath: "C:\\Users\\demo\\scoop\\apps\\bun\\current\\bun.exe",
      }),
    ).toBe(false)
  })
})
