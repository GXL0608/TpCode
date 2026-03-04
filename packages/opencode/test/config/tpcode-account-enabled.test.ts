import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Flag } from "../../src/flag/flag"

const originalCwd = process.cwd()
const originalAccountEnv = process.env["TPCODE_ACCOUNT_ENABLED"]

afterEach(() => {
  process.chdir(originalCwd)
  if (originalAccountEnv === undefined) {
    delete process.env["TPCODE_ACCOUNT_ENABLED"]
    return
  }
  process.env["TPCODE_ACCOUNT_ENABLED"] = originalAccountEnv
})

async function withProjectConfig(content: string, fn: () => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-tpcode-account-"))
  const configDir = path.join(dir, ".opencode")
  const configPath = path.join(configDir, "opencode.jsonc")
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(configPath, content, "utf-8")
  process.chdir(dir)
  try {
    await fn()
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

test("reads true from opencode.jsonc", async () => {
  await withProjectConfig(
    `{
      "$schema": "https://opencode.ai/config.json",
      "TPCODE_ACCOUNT_ENABLED": true
    }`,
    async () => {
      expect(Flag.TPCODE_ACCOUNT_ENABLED).toBe(true)
    },
  )
})

test("reads false from opencode.jsonc", async () => {
  await withProjectConfig(
    `{
      "$schema": "https://opencode.ai/config.json",
      "TPCODE_ACCOUNT_ENABLED": false
    }`,
    async () => {
      expect(Flag.TPCODE_ACCOUNT_ENABLED).toBe(false)
    },
  )
})

test("defaults to true when key is missing", async () => {
  await withProjectConfig(
    `{
      "$schema": "https://opencode.ai/config.json"
    }`,
    async () => {
      expect(Flag.TPCODE_ACCOUNT_ENABLED).toBe(true)
    },
  )
})

test("ignores TPCODE_ACCOUNT_ENABLED environment variable", async () => {
  process.env["TPCODE_ACCOUNT_ENABLED"] = "0"
  await withProjectConfig(
    `{
      "$schema": "https://opencode.ai/config.json",
      "TPCODE_ACCOUNT_ENABLED": true
    }`,
    async () => {
      expect(Flag.TPCODE_ACCOUNT_ENABLED).toBe(true)
    },
  )
})
