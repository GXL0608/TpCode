import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { BunProc } from "../../src/bun"

describe("bun install backoff", () => {
  afterEach(() => {
    BunProc.resetInstallBackoff()
    mock.restore()
  })

  test("backs off repeated failed installs for the same package version", async () => {
    const run = spyOn(BunProc, "run").mockRejectedValue(new Error("network down"))
    const pkg = "tpcode-install-backoff-test"
    const version = "0.0.0-missing"

    await expect(BunProc.install(pkg, version)).rejects.toBeInstanceOf(BunProc.InstallFailedError)
    await expect(BunProc.install(pkg, version)).rejects.toBeInstanceOf(BunProc.InstallBackoffError)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
