import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { GatewayState } from "../../src/server/gateway-state"

const originalCwd = process.cwd()
const originalNow = Date.now

function mockNow(start = 1_700_000_000_000) {
  let now = start
  Date.now = () => now
  return {
    advance(ms: number) {
      now += ms
      return now
    },
  }
}

afterEach(() => {
  process.chdir(originalCwd)
  Date.now = originalNow
  GatewayState.init({
    nodeId: "test-reset",
    host: "127.0.0.1",
    port: 4096,
  })
})

async function withAccountDisabled(fn: () => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gateway-routes-"))
  const configDir = path.join(dir, ".opencode")
  const configPath = path.join(configDir, "opencode.jsonc")
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(
    configPath,
    ['{', '  "$schema": "https://opencode.ai/config.json",', '  "TPCODE_ACCOUNT_ENABLED": false', "}"].join("\n"),
    "utf-8",
  )
  process.chdir(dir)
  try {
    await fn()
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

describe("server gateway routes", () => {
  test("exposes readiness, node and health status", async () => {
    await withAccountDisabled(async () => {
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        nodeId: "node-route",
        host: "127.0.0.1",
        port: 4096,
        drain: false,
      })

      const ready = await Server.App().request("/global/ready")
      expect(ready.status).toBe(200)
      const readyPayload = (await ready.json()) as Record<string, unknown>
      expect(readyPayload.ready).toBe(true)

      const node = await Server.App().request("/global/node")
      expect(node.status).toBe(200)
      const nodePayload = (await node.json()) as Record<string, unknown>
      expect(nodePayload.id).toBe("node-route")
      expect(nodePayload.ready).toBe(true)

      const drain = await Server.App().request("/global/drain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, reason: "maintenance" }),
      })
      expect(drain.status).toBe(200)
      const drainPayload = (await drain.json()) as Record<string, unknown>
      expect(drainPayload.ok).toBe(true)
      expect(drainPayload.drain).toBe(true)

      const notReady = await Server.App().request("/global/ready")
      expect(notReady.status).toBe(503)
      const notReadyPayload = (await notReady.json()) as Record<string, unknown>
      expect(notReadyPayload.ready).toBe(false)
      expect(notReadyPayload.reason).toBe("draining")

      const health = await Server.App().request("/global/health")
      expect(health.status).toBe(200)
      const healthPayload = (await health.json()) as Record<string, unknown>
      expect(healthPayload.ready).toBe(false)
      expect((healthPayload.node as Record<string, unknown>).drain).toBe(true)
    })
  })

  test("rejects write requests while draining", async () => {
    await withAccountDisabled(async () => {
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        nodeId: "node-drain",
        host: "127.0.0.1",
        port: 4096,
      })

      const enable = await Server.App().request("/global/drain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      expect(enable.status).toBe(200)

      const response = await Server.App().request("/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "drain-test" }),
      })
      expect(response.status).toBe(503)
      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.error).toBe("server_busy")
      expect(payload.code).toBe("draining")
    })
  })

  test("exposes not-ready while overload is sustained", async () => {
    await withAccountDisabled(async () => {
      const clock = mockNow()
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        enabled: true,
        nodeId: "node-overload-ready",
        host: "127.0.0.1",
        port: 4096,
        maxWriteInflight: 1,
        rejectWriteOnOverload: true,
      })
      expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
      expect(GatewayState.tryEnterWrite()).toEqual({
        ok: false,
        code: "overloaded",
        retryAfterMs: 1000,
      })

      const ready = await Server.App().request("/global/ready")
      expect(ready.status).toBe(200)

      clock.advance(5000)
      expect(GatewayState.tryEnterWrite()).toEqual({
        ok: false,
        code: "overloaded",
        retryAfterMs: 1000,
      })

      const notReady = await Server.App().request("/global/ready")
      expect(notReady.status).toBe(503)
      const payload = (await notReady.json()) as Record<string, unknown>
      expect(payload.ready).toBe(false)
      expect(payload.reason).toBe("overloaded")
    })
  })

  test("rejects write requests on routes declared before account routes", async () => {
    await withAccountDisabled(async () => {
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        nodeId: "node-early-route",
        host: "127.0.0.1",
        port: 4096,
      })
      await Server.App().request("/global/drain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })

      const response = await Server.App().request("/auth/test-provider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(503)
      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.error).toBe("server_busy")
      expect(payload.code).toBe("draining")
    })
  })

  test("keeps login and token refresh available while draining", async () => {
    await withAccountDisabled(async () => {
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        nodeId: "node-account-whitelist",
        host: "127.0.0.1",
        port: 4096,
      })
      await Server.App().request("/global/drain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })

      const login = await Server.App().request("/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "u", password: "p" }),
      })
      expect(login.status).not.toBe(503)

      const vho = await Server.App().request("/account/login/vho", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: "13600000000", login_type: "vho" }),
      })
      expect(vho.status).not.toBe(503)

      const refresh = await Server.App().request("/account/token/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: "x" }),
      })
      expect(refresh.status).not.toBe(503)
    })
  })

  test("does not reject writes when gateway mode is disabled", async () => {
    await withAccountDisabled(async () => {
      const { Server } = await import("../../src/server/server")
      GatewayState.init({
        enabled: false,
        nodeId: "node-disabled",
        host: "127.0.0.1",
        port: 4096,
      })

      const response = await Server.App().request("/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "normal-mode" }),
      })
      expect(response.status).not.toBe(503)
    })
  })
})
