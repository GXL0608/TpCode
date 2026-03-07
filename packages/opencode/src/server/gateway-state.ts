import { hostname, networkInterfaces } from "os"
import { ServerDegraded } from "./degraded"

const OVERLOAD_CHECK = "gateway.write"
const NODE_CHECK = "gateway.node"
const SOURCE = "gateway.state"
const RETRY_AFTER_MS = 1000
// 避免瞬时尖峰把节点立刻摘出，连续过载达到窗口后再对外标记 not-ready。
const OVERLOAD_READY_AFTER_MS = 5000
// 节点恢复后保留冷却期，避免 Traefik 因 ready 状态频繁抖动。
const OVERLOAD_RECOVER_AFTER_MS = 10000

type Init = {
  enabled?: boolean
  nodeId?: string
  drain?: boolean
  maxWriteInflight?: number
  rejectWriteOnOverload?: boolean
  host?: string
  port?: number
}

type EnterResult =
  | {
      ok: true
    }
  | {
      ok: false
      code: "draining" | "overloaded"
      retryAfterMs: number
    }

const state = {
  enabled: false,
  id: "",
  host: "",
  port: 0,
  startedAt: Date.now(),
  drain: false,
  reason: undefined as string | undefined,
  maxWriteInflight: 64,
  rejectWriteOnOverload: true,
  writeInflight: 0,
  overloadSince: undefined as number | undefined,
  overloadRecoverSince: undefined as number | undefined,
  overloadReady: false,
  updatedAt: Date.now(),
}

function normalizeNodeID(input: Init) {
  if (input.nodeId) return input.nodeId
  if (input.host && typeof input.port === "number" && input.port > 0) return `${input.host}:${input.port}`
  return `${hostname()}:${process.pid}`
}

function wildcard(host?: string) {
  return host === "0.0.0.0" || host === "::" || host === "::0"
}

function localIP() {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .find((addr) => addr.family === "IPv4" && !addr.internal)?.address
}

function normalizeHost(host?: string) {
  if (!host) return localIP() || hostname()
  if (!wildcard(host)) return host
  return localIP() || hostname()
}

function normalizeMax(input?: number) {
  if (!Number.isInteger(input)) return 64
  if (!input || input < 1) return 64
  return input
}

function clearOverload() {
  ServerDegraded.clear(
    OVERLOAD_CHECK,
    {
      write_inflight: state.writeInflight,
      max_write_inflight: state.maxWriteInflight,
    },
    SOURCE,
  )
}

function touch() {
  state.updatedAt = Date.now()
}

function setOverloadReady(input: boolean) {
  if (state.overloadReady === input) return
  state.overloadReady = input
  touch()
}

function resetOverloadWindow() {
  state.overloadSince = undefined
  state.overloadRecoverSince = undefined
  setOverloadReady(false)
}

function syncOverload(now = Date.now()) {
  if (!state.enabled || !state.rejectWriteOnOverload) {
    resetOverloadWindow()
    return
  }
  if (state.writeInflight >= state.maxWriteInflight) {
    // 节点持续满载时开始累计过载窗口，到阈值后 readiness 才会变成 false。
    if (!state.overloadSince) state.overloadSince = now
    state.overloadRecoverSince = undefined
    if (now - state.overloadSince >= OVERLOAD_READY_AFTER_MS) {
      setOverloadReady(true)
    }
    return
  }
  if (!state.overloadReady) {
    state.overloadSince = undefined
    state.overloadRecoverSince = undefined
    return
  }
  // 从过载恢复后继续观察一段时间，稳定后再恢复 ready。
  if (!state.overloadRecoverSince) {
    state.overloadRecoverSince = now
    return
  }
  if (now - state.overloadRecoverSince < OVERLOAD_RECOVER_AFTER_MS) return
  resetOverloadWindow()
}

function markOverload() {
  syncOverload()
  ServerDegraded.mark(
    OVERLOAD_CHECK,
    "overloaded",
    {
      write_inflight: state.writeInflight,
      max_write_inflight: state.maxWriteInflight,
      overload_ready: state.overloadReady,
    },
    SOURCE,
  )
}

function markDrain() {
  if (!state.drain) {
    ServerDegraded.clear(
      NODE_CHECK,
      {
        drain: false,
      },
      SOURCE,
    )
    return
  }
  ServerDegraded.mark(
    NODE_CHECK,
    "draining",
    {
      drain: true,
      reason: state.reason,
    },
    SOURCE,
  )
}

function ready() {
  syncOverload()
  if (state.drain) {
    return {
      ready: false as const,
      reason: "draining",
    }
  }
  if (state.overloadReady) {
    return {
      ready: false as const,
      reason: "overloaded",
    }
  }
  return {
    ready: true as const,
    reason: undefined,
  }
}

export namespace GatewayState {
  export function init(input: Init) {
    const host = normalizeHost(input.host)
    // drain 模式必须强制启用保护，否则 ready=false 与写入拦截会不一致。
    state.enabled = (input.enabled ?? false) || (input.drain ?? false)
    state.host = host
    state.id = normalizeNodeID({
      ...input,
      host,
    })
    state.port = input.port ?? state.port
    state.startedAt = Date.now()
    state.drain = input.drain ?? false
    state.reason = state.drain ? "configured_drain" : undefined
    state.maxWriteInflight = normalizeMax(input.maxWriteInflight)
    state.rejectWriteOnOverload = input.rejectWriteOnOverload ?? true
    state.writeInflight = 0
    state.overloadSince = undefined
    state.overloadRecoverSince = undefined
    state.overloadReady = false
    touch()
    clearOverload()
    markDrain()
  }

  export function tryEnterWrite(): EnterResult {
    if (!state.enabled) return { ok: true }
    if (state.drain) {
      return {
        ok: false,
        code: "draining",
        retryAfterMs: RETRY_AFTER_MS,
      }
    }
    if (!state.rejectWriteOnOverload) {
      state.writeInflight += 1
      syncOverload()
      return { ok: true }
    }
    if (state.writeInflight >= state.maxWriteInflight) {
      // 写入被拒时也要推进过载状态机，否则 readiness 不会进入摘流状态。
      markOverload()
      return {
        ok: false,
        code: "overloaded",
        retryAfterMs: RETRY_AFTER_MS,
      }
    }
    state.writeInflight += 1
    syncOverload()
    if (state.writeInflight < state.maxWriteInflight) {
      clearOverload()
    }
    return { ok: true }
  }

  export function leaveWrite() {
    if (state.writeInflight < 1) return
    state.writeInflight -= 1
    syncOverload()
    if (state.writeInflight >= state.maxWriteInflight) return
    clearOverload()
  }

  export function setDrain(input: { enabled: boolean; reason?: string }) {
    if (input.enabled) state.enabled = true
    state.drain = input.enabled
    state.reason = input.enabled ? input.reason || "manual_drain" : undefined
    touch()
    markDrain()
    return {
      ok: true as const,
      drain: state.drain,
      reason: state.reason,
      updatedAt: state.updatedAt,
    }
  }

  export function snapshot() {
    const status = ready()
    return {
      id: state.id || `${hostname()}:${process.pid}`,
      host: state.host || hostname(),
      port: state.port,
      pid: process.pid,
      startedAt: state.startedAt,
      drain: state.drain,
      writeInflight: state.writeInflight,
      maxWriteInflight: state.maxWriteInflight,
      rejectWriteOnOverload: state.rejectWriteOnOverload,
      ready: status.ready,
      reason: status.reason,
      updatedAt: state.updatedAt,
    }
  }

  export function readiness() {
    return ready()
  }
}
