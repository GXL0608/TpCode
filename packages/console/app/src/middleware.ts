import { createMiddleware } from "@solidjs/start/middleware"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"

function delta(path: string) {
  const next = strip(path)
  return next === "/delta-test" || next === "/api/delta"
}

export default createMiddleware({
  onRequest(event) {
    const url = new URL(event.request.url)
    if (process.env.ENABLE_DELTA_TEST !== "1" && delta(url.pathname)) {
      return new Response(null, { status: 404 })
    }

    const locale = fromPathname(url.pathname)
    if (!locale) return

    url.pathname = strip(url.pathname)
    const request = new Request(url, event.request)
    request.headers.set(LOCALE_HEADER, locale)
    event.request = request
    event.response.headers.append("set-cookie", cookie(locale))
  },
})
