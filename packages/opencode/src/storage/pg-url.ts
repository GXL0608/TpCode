const base = "postgres://opencode:opencode@182.92.74.187:9124"
const local = `${base}/opencode_dev`
const remote = `${base}/opencode`

/** 中文注释：仅在 local 渠道且由 Bun 直接运行源码时才默认回退开发库，避免打包产物误连开发库。 */
export function pgLocalDefault(input: { channel?: string; execPath?: string }) {
  if (input.channel !== "local") return false
  const exec = (input.execPath ?? "").replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? ""
  return exec === "bun" || exec === "bun.exe"
}

export function pgDefault(dev: boolean) {
  return dev ? local : remote
}

export function pgSource(env: Record<string, string | undefined>, dev: boolean) {
  if (env.OPENCODE_DATABASE_URL) return "OPENCODE_DATABASE_URL"
  if (env.OPENCODE_PG_URL) return "OPENCODE_PG_URL"
  return dev ? "DEFAULT_SEED_LOCAL" : "DEFAULT_SEED_PACKAGED"
}

export function pgUrl(env: Record<string, string | undefined>, dev: boolean) {
  return env.OPENCODE_DATABASE_URL ?? env.OPENCODE_PG_URL ?? pgDefault(dev)
}
