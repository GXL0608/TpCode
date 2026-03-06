const base = "postgres://opencode:opencode@182.92.74.187:9124"
const local = `${base}/opencode_dev`
const remote = `${base}/opencode`

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
