import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

async function withProjectConfig(input: { enabled?: boolean }, fn: () => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-account-enabled-"))
  const configDir = path.join(dir, ".opencode")
  const configPath = path.join(configDir, "opencode.jsonc")
  await fs.mkdir(configDir, { recursive: true })
  const lines = ['{', '  "$schema": "https://opencode.ai/config.json"']
  if (typeof input.enabled === "boolean") {
    lines.push(`,  "TPCODE_ACCOUNT_ENABLED": ${input.enabled ? "true" : "false"}`)
  }
  lines.push("}")
  await fs.writeFile(configPath, lines.join("\n"), "utf-8")
  process.chdir(dir)
  try {
    await fn()
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function loginWithEmptyBody() {
  const { Server } = await import("../../src/server/server")
  return Server.App().request("/account/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
}

describe("account enabled from config", () => {
  test("returns 404 when TPCODE_ACCOUNT_ENABLED is false", async () => {
    await withProjectConfig({ enabled: false }, async () => {
      const response = await loginWithEmptyBody()
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "account_disabled" })
    })
  })

  test("returns 400 when TPCODE_ACCOUNT_ENABLED is true", async () => {
    await withProjectConfig({ enabled: true }, async () => {
      const response = await loginWithEmptyBody()
      expect(response.status).toBe(400)
    })
  })

  test("defaults to enabled when key is missing", async () => {
    await withProjectConfig({}, async () => {
      const response = await loginWithEmptyBody()
      expect(response.status).toBe(400)
    })
  })
})
