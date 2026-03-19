/** 中文注释：把受保护页面的完整本地路由编码到登录地址里，确保登录成功后能回到原页面。 */
export function loginRedirectHref(pathname: string, search: string) {
  const params = new URLSearchParams()
  const target = `${pathname}${search}`
  if (target && target !== "/") params.set("redirect", target)
  const value = params.toString()
  return value ? `/login?${value}` : "/login"
}

/** 中文注释：从登录页查询参数里解析登录成功后的返回地址，并阻止跳到站外或协议相对地址。 */
export function loginSuccessHref(search: string) {
  const redirect = new URLSearchParams(search).get("redirect")?.trim()
  if (!redirect) return "/"
  if (!redirect.startsWith("/")) return "/"
  if (redirect.startsWith("//")) return "/"
  return redirect
}
