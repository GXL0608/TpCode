import { afterEach, describe, expect, test } from "bun:test"
import { GatewayState } from "../../src/server/gateway-state"

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
  Date.now = originalNow
})

describe("server/gateway-state", () => {
  test("toggles readiness with drain state", () => {
    GatewayState.init({
      nodeId: "node-ready",
      drain: false,
      host: "127.0.0.1",
      port: 4096,
    })
    expect(GatewayState.readiness()).toEqual({ ready: true, reason: undefined })
    GatewayState.setDrain({ enabled: true, reason: "maintenance" })
    expect(GatewayState.readiness()).toEqual({ ready: false, reason: "draining" })
    GatewayState.setDrain({ enabled: false })
    expect(GatewayState.readiness()).toEqual({ ready: true, reason: undefined })
  })

  test("rejects writes when overloaded", () => {
    GatewayState.init({
      enabled: true,
      nodeId: "node-overload",
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
    GatewayState.leaveWrite()
    expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
    GatewayState.leaveWrite()
  })

  test("marks node not-ready after sustained overload and recovers after cooldown", () => {
    const clock = mockNow()
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
    expect(GatewayState.readiness()).toEqual({ ready: true, reason: undefined })
    clock.advance(5000)
    expect(GatewayState.tryEnterWrite()).toEqual({
      ok: false,
      code: "overloaded",
      retryAfterMs: 1000,
    })
    expect(GatewayState.readiness()).toEqual({ ready: false, reason: "overloaded" })
    GatewayState.leaveWrite()
    expect(GatewayState.readiness()).toEqual({ ready: false, reason: "overloaded" })
    clock.advance(9999)
    expect(GatewayState.readiness()).toEqual({ ready: false, reason: "overloaded" })
    clock.advance(1)
    expect(GatewayState.readiness()).toEqual({ ready: true, reason: undefined })
  })

  test("allows writes when overload rejection is disabled", () => {
    GatewayState.init({
      enabled: true,
      nodeId: "node-relaxed",
      host: "127.0.0.1",
      port: 4096,
      maxWriteInflight: 1,
      rejectWriteOnOverload: false,
    })
    expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
    expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
    GatewayState.leaveWrite()
    GatewayState.leaveWrite()
  })

  test("bypasses write protection when gateway is disabled", () => {
    GatewayState.init({
      enabled: false,
      nodeId: "node-disabled",
      host: "127.0.0.1",
      port: 4096,
      maxWriteInflight: 1,
      rejectWriteOnOverload: true,
    })
    expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
    expect(GatewayState.tryEnterWrite()).toEqual({ ok: true })
    GatewayState.leaveWrite()
    GatewayState.leaveWrite()
  })

  test("enables gateway protection when drain is set", () => {
    GatewayState.init({
      enabled: false,
      nodeId: "node-drain-enable",
      host: "127.0.0.1",
      port: 4096,
    })
    GatewayState.setDrain({ enabled: true })
    expect(GatewayState.tryEnterWrite()).toEqual({
      ok: false,
      code: "draining",
      retryAfterMs: 1000,
    })
  })

  test("treats configured drain as enabled protection", () => {
    GatewayState.init({
      enabled: false,
      drain: true,
      nodeId: "node-config-drain",
      host: "127.0.0.1",
      port: 4096,
    })
    expect(GatewayState.tryEnterWrite()).toEqual({
      ok: false,
      code: "draining",
      retryAfterMs: 1000,
    })
  })

  test("avoids wildcard address in auto node id", () => {
    GatewayState.init({
      host: "0.0.0.0",
      port: 4096,
    })
    const node = GatewayState.snapshot()
    expect(node.id).not.toBe("0.0.0.0:4096")
    expect(node.host).not.toBe("0.0.0.0")
  })
})
