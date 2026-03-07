function append(url: string, token?: string) {
  if (!token) return url
  if (/(?:^|[?&])access_token=/.test(url)) return url
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}access_token=${encodeURIComponent(token)}`
}

export function resolveMessageAttachmentUrl(input: { url?: string; base?: string; token?: string }) {
  if (!input.url) return input.url
  if (!input.url.startsWith("/")) return input.url

  const base = input.base ?? (typeof window === "undefined" ? undefined : window.location.origin)
  if (!base || !URL.canParse(input.url, base)) return append(input.url, input.token)

  const next = new URL(input.url, base)
  if (input.token && !next.searchParams.has("access_token")) {
    next.searchParams.set("access_token", input.token)
  }
  return next.toString()
}
