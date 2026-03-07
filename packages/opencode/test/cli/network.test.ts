import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { resolveNetworkOptions } from "../../src/cli/network"
import { Config } from "../../src/config/config"

const argv = process.argv.slice()
const env = {
  OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  TPCODE_GATEWAY_NODE_ID: process.env.TPCODE_GATEWAY_NODE_ID,
  TPCODE_GATEWAY_DRAIN: process.env.TPCODE_GATEWAY_DRAIN,
  TPCODE_GATEWAY_ENABLED: process.env.TPCODE_GATEWAY_ENABLED,
  TPCODE_GATEWAY_WEB_ENABLED: process.env.TPCODE_GATEWAY_WEB_ENABLED,
  TPCODE_GATEWAY_WEB_URL: process.env.TPCODE_GATEWAY_WEB_URL,
}
const dirs: string[] = []

afterEach(async () => {
  process.argv = argv.slice()
  if (env.OPENCODE_CONFIG_DIR === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = env.OPENCODE_CONFIG_DIR
  if (env.TPCODE_GATEWAY_NODE_ID === undefined) delete process.env.TPCODE_GATEWAY_NODE_ID
  else process.env.TPCODE_GATEWAY_NODE_ID = env.TPCODE_GATEWAY_NODE_ID
  if (env.TPCODE_GATEWAY_DRAIN === undefined) delete process.env.TPCODE_GATEWAY_DRAIN
  else process.env.TPCODE_GATEWAY_DRAIN = env.TPCODE_GATEWAY_DRAIN
  if (env.TPCODE_GATEWAY_ENABLED === undefined) delete process.env.TPCODE_GATEWAY_ENABLED
  else process.env.TPCODE_GATEWAY_ENABLED = env.TPCODE_GATEWAY_ENABLED
  if (env.TPCODE_GATEWAY_WEB_ENABLED === undefined) delete process.env.TPCODE_GATEWAY_WEB_ENABLED
  else process.env.TPCODE_GATEWAY_WEB_ENABLED = env.TPCODE_GATEWAY_WEB_ENABLED
  if (env.TPCODE_GATEWAY_WEB_URL === undefined) delete process.env.TPCODE_GATEWAY_WEB_URL
  else process.env.TPCODE_GATEWAY_WEB_URL = env.TPCODE_GATEWAY_WEB_URL
  Config.global.reset()
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

async function isolated() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-network-test-"))
  dirs.push(dir)
  process.env.OPENCODE_CONFIG_DIR = dir
  Config.global.reset()
}

function args() {
  return {
    port: 0,
    hostname: "127.0.0.1",
    mdns: false,
    "mdns-domain": "opencode.local",
    cors: [],
  } as const
}

test("supports --node-id=value CLI syntax", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_NODE_ID = "env-node"
  process.argv = ["bun", "opencode", "serve", "--node-id=cli-node"]
  const result = await resolveNetworkOptions({
    ...args(),
    "node-id": "cli-node",
  } as any)
  expect(result.gateway.nodeId).toBe("cli-node")
})

test("supports --no-drain override", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_DRAIN = "1"
  process.argv = ["bun", "opencode", "serve", "--no-drain"]
  const result = await resolveNetworkOptions({
    ...args(),
    drain: false,
  } as any)
  expect(result.gateway.drain).toBe(false)
})

test("supports --no-gateway-enabled override", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_ENABLED = "1"
  process.argv = ["bun", "opencode", "serve", "--no-gateway-enabled"]
  const result = await resolveNetworkOptions({
    ...args(),
    "gateway-enabled": false,
  } as any)
  expect(result.gateway.enabled).toBe(false)
})

test("enables gateway mode when drain is enabled", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_ENABLED = "0"
  process.env.TPCODE_GATEWAY_DRAIN = "1"
  process.argv = ["bun", "opencode", "serve"]
  const result = await resolveNetworkOptions(args() as any)
  expect(result.gateway.drain).toBe(true)
  expect(result.gateway.enabled).toBe(true)
})

test("supports gateway web config from env", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_WEB_ENABLED = "1"
  process.env.TPCODE_GATEWAY_WEB_URL = "https://tpcode.xxx///"
  process.argv = ["bun", "opencode", "serve"]
  const result = await resolveNetworkOptions(args() as any)
  expect(result.gateway.webEnabled).toBe(true)
  expect(result.gateway.webUrl).toBe("https://tpcode.xxx")
})

test("supports --no-gateway-web-enabled override", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_WEB_ENABLED = "1"
  process.env.TPCODE_GATEWAY_WEB_URL = "https://tpcode.xxx"
  process.argv = ["bun", "opencode", "serve", "--no-gateway-web-enabled"]
  const result = await resolveNetworkOptions({
    ...args(),
    "gateway-web-enabled": false,
  } as any)
  expect(result.gateway.webEnabled).toBe(false)
  expect(result.gateway.webUrl).toBeUndefined()
})

test("throws when gateway web is enabled without gateway web url", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_WEB_ENABLED = "1"
  delete process.env.TPCODE_GATEWAY_WEB_URL
  process.argv = ["bun", "opencode", "serve"]
  expect(resolveNetworkOptions(args() as any)).rejects.toThrow(
    "Gateway web is enabled but webUrl is missing",
  )
})

test("ignores gateway web url when gateway web is disabled", async () => {
  await isolated()
  process.env.TPCODE_GATEWAY_WEB_ENABLED = "0"
  process.env.TPCODE_GATEWAY_WEB_URL = "https://tpcode.xxx"
  process.argv = ["bun", "opencode", "serve"]
  const result = await resolveNetworkOptions(args() as any)
  expect(result.gateway.webEnabled).toBe(false)
  expect(result.gateway.webUrl).toBeUndefined()
})

test("keeps gateway disabled by default in local source mode", async () => {
  await isolated()
  delete process.env.TPCODE_GATEWAY_ENABLED
  delete process.env.TPCODE_GATEWAY_DRAIN
  delete process.env.TPCODE_GATEWAY_WEB_ENABLED
  delete process.env.TPCODE_GATEWAY_WEB_URL
  process.argv = ["bun", "opencode", "serve"]
  const result = await resolveNetworkOptions(args() as any)
  expect(result.gateway.drain).toBe(false)
  expect(result.gateway.enabled).toBe(false)
  expect(result.gateway.webEnabled).toBe(false)
  expect(result.gateway.webUrl).toBeUndefined()
})
