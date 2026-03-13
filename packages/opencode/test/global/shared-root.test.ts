import { describe, expect, test } from "bun:test"
import path from "path"
import { resolvePaths } from "../../src/global"

describe("global shared root", () => {
  test("keeps local runtime on existing xdg directories", () => {
    const result = resolvePaths({
      local: true,
      xdg: {
        data: "/tmp/data",
        cache: "/tmp/cache",
        config: "/tmp/config",
        state: "/tmp/state",
      },
    })

    expect(result.data).toBe("/tmp/data/opencode")
    expect(result.cache).toBe("/tmp/cache/opencode")
    expect(result.config).toBe("/tmp/config/opencode")
    expect(result.state).toBe("/tmp/state/opencode")
    expect(result.bin).toBe(path.join("/tmp/data", "opencode", "bin"))
    expect(result.log).toBe(path.join("/tmp/data", "opencode", "log"))
  })

  test("ignores shared root override during local runtime", () => {
    const result = resolvePaths({
      local: true,
      sharedRoot: "Z:\\shared\\tpcode",
      xdg: {
        data: "/tmp/data",
        cache: "/tmp/cache",
        config: "/tmp/config",
        state: "/tmp/state",
      },
    })

    expect(result.data).toBe("/tmp/data/opencode")
    expect(result.cache).toBe("/tmp/cache/opencode")
    expect(result.config).toBe("/tmp/config/opencode")
    expect(result.state).toBe("/tmp/state/opencode")
  })

  test("uses packaged default shared root when runtime is not local", () => {
    const result = resolvePaths({
      local: false,
      xdg: {
        data: "/tmp/data",
        cache: "/tmp/cache",
        config: "/tmp/config",
        state: "/tmp/state",
      },
    })

    expect(result.data).toBe(path.win32.join("Y:\\tpcode", ".local", "share", "opencode"))
    expect(result.cache).toBe(path.win32.join("Y:\\tpcode", ".cache", "opencode"))
    expect(result.config).toBe(path.win32.join("Y:\\tpcode", ".config", "opencode"))
    expect(result.state).toBe(path.win32.join("Y:\\tpcode", ".local", "state", "opencode"))
    expect(result.bin).toBe(path.win32.join("Y:\\tpcode", ".local", "share", "opencode", "bin"))
    expect(result.log).toBe(path.win32.join("Y:\\tpcode", ".local", "share", "opencode", "log"))
  })

  test("prefers explicit shared root for packaged runtime", () => {
    const result = resolvePaths({
      local: false,
      sharedRoot: "Z:\\shared\\tpcode",
      xdg: {
        data: "/tmp/data",
        cache: "/tmp/cache",
        config: "/tmp/config",
        state: "/tmp/state",
      },
    })

    expect(result.data).toBe(path.win32.join("Z:\\shared\\tpcode", ".local", "share", "opencode"))
    expect(result.cache).toBe(path.win32.join("Z:\\shared\\tpcode", ".cache", "opencode"))
    expect(result.config).toBe(path.win32.join("Z:\\shared\\tpcode", ".config", "opencode"))
    expect(result.state).toBe(path.win32.join("Z:\\shared\\tpcode", ".local", "state", "opencode"))
  })
})
