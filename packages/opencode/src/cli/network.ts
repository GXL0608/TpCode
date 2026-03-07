import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { Installation } from "../installation"
import { resolveWebGateway } from "../server/web-gateway"
import { Instance } from "../project/instance"

const PACKAGED_WEB_URL = "http://220.249.52.218:8081"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: opencode.local)",
    default: "opencode.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
  "node-id": {
    type: "string" as const,
    describe: "node id exposed for gateway routing and observability",
  },
  drain: {
    type: "boolean" as const,
    describe: "mark server not-ready for gateway health checks",
  },
  "max-write-inflight": {
    type: "number" as const,
    describe: "maximum concurrent write requests before rejecting",
  },
  "reject-write-on-overload": {
    type: "boolean" as const,
    describe: "reject write requests with 503 when overloaded",
  },
  "gateway-enabled": {
    type: "boolean" as const,
    describe: "enable gateway write protection and drain mode controls",
  },
  "gateway-web-enabled": {
    type: "boolean" as const,
    describe: "enable web defaulting to the configured gateway web url",
  },
  "gateway-web-url": {
    type: "string" as const,
    describe: "gateway url used by bundled web as the default api endpoint",
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

function argSet(flag: string) {
  return process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
}

function boolArgSet(flag: string) {
  const key = flag.replace(/^--/, "")
  return argSet(flag) || argSet(`--no-${key}`)
}

function envBool(key: string) {
  const value = process.env[key]?.toLowerCase()
  if (value === undefined) return
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
}

function envInt(key: string) {
  const value = process.env[key]
  if (value === undefined) return
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return
  return parsed
}

function own<T extends object>(input: T | undefined, key: keyof T) {
  if (!input) return false
  return Object.prototype.hasOwnProperty.call(input, key)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Instance.provide({
    directory: process.cwd(),
    fn: () => Config.get().catch(() => Config.getGlobal()),
  }).catch(() => Config.getGlobal())
  const defaultEnabled = !Installation.isLocal()
  const portExplicitlySet = argSet("--port")
  const hostnameExplicitlySet = argSet("--hostname")
  const mdnsExplicitlySet = argSet("--mdns")
  const mdnsDomainExplicitlySet = argSet("--mdns-domain")
  const corsExplicitlySet = argSet("--cors")
  const nodeIDExplicitlySet = argSet("--node-id")
  const drainExplicitlySet = boolArgSet("--drain")
  const maxWriteInflightExplicitlySet = argSet("--max-write-inflight")
  const rejectWriteOnOverloadExplicitlySet = boolArgSet("--reject-write-on-overload")
  const gatewayEnabledExplicitlySet = boolArgSet("--gateway-enabled")
  const gatewayWebEnabledExplicitlySet = boolArgSet("--gateway-web-enabled")
  const gatewayWebUrlExplicitlySet = argSet("--gateway-web-url")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const defaultCors = defaultEnabled ? [PACKAGED_WEB_URL] : []
  const configCors = own(config?.server, "cors") ? (config?.server?.cors ?? []) : defaultCors
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]
  const gateway = config?.server?.gateway
  const nodeID = nodeIDExplicitlySet ? args["node-id"] : (process.env["TPCODE_GATEWAY_NODE_ID"] ?? gateway?.nodeId)
  const drain = drainExplicitlySet
    ? (args.drain ?? false)
    : (envBool("TPCODE_GATEWAY_DRAIN") ?? gateway?.drain ?? false)
  const enabled =
    (gatewayEnabledExplicitlySet
      ? (args["gateway-enabled"] ?? true)
      : (envBool("TPCODE_GATEWAY_ENABLED") ?? gateway?.enabled ?? defaultEnabled)) || drain
  const maxWriteInflight = maxWriteInflightExplicitlySet
    ? (args["max-write-inflight"] ?? 64)
    : (envInt("TPCODE_GATEWAY_MAX_WRITE_INFLIGHT") ?? gateway?.maxWriteInflight ?? 64)
  const rejectWriteOnOverload = rejectWriteOnOverloadExplicitlySet
    ? (args["reject-write-on-overload"] ?? true)
    : (envBool("TPCODE_GATEWAY_REJECT_WRITE_ON_OVERLOAD") ?? gateway?.rejectWriteOnOverload ?? true)
  const webEnabled = gatewayWebEnabledExplicitlySet
    ? (args["gateway-web-enabled"] ?? true)
    : (envBool("TPCODE_GATEWAY_WEB_ENABLED") ?? gateway?.webEnabled ?? defaultEnabled)
  const web = resolveWebGateway({
    enabled: webEnabled,
    url: gatewayWebUrlExplicitlySet
      ? args["gateway-web-url"]
      : (process.env["TPCODE_GATEWAY_WEB_URL"] ??
          (own(gateway, "webUrl") ? gateway?.webUrl : undefined) ??
          (defaultEnabled ? PACKAGED_WEB_URL : undefined)),
    defaultEnabled,
  })

  return {
    hostname,
    port,
    mdns,
    mdnsDomain,
    cors,
    gateway: {
      enabled,
      nodeId: nodeID,
      drain,
      maxWriteInflight,
      rejectWriteOnOverload,
      webEnabled: web.enabled,
      webUrl: web.url,
    },
  }
}
