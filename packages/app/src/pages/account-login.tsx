import { Button } from "@opencode-ai/ui/button"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { Show, createSignal, createEffect } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { loginSuccessHref } from "@/utils/account-login-redirect"

/** 中文注释：登录页在登录成功后优先回到用户原本要访问的深链接，避免产品会话入口丢失。 */
export default function AccountLogin() {
  const auth = useAccountAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [auto, setAuto] = createSignal(false)

  const loginErrorText = (code?: string) => {
    if (code === "user_locked") return "账号已锁定，请稍后重试"
    if (code === "invalid_credentials") return "登录失败，请检查账号或密码"
    if (code === "vho_login_type_invalid") return "直登失败：loginType 必须为 vho"
    if (code === "phone_invalid") return "直登失败：手机号格式不正确"
    if (code === "vho_user_not_found") return "直登失败：手机号未匹配到账号"
    if (code === "vho_login_failed") return "直登失败，请改用账号密码登录"
    if (code === "account_disabled") return "账号系统未启用"
    return "登录失败，请检查账号或密码"
  }

  const vhoInput = () => {
    const params = new URLSearchParams(location.search)
    const userId = params.get("userId")?.trim()
    const loginType = params.get("loginType")?.trim()
    if (!userId || !loginType) return
    return { userId, loginType }
  }

  /** 中文注释：统一处理登录成功后的跳转目标，优先恢复深链接，否则回首页。 */
  const finishLogin = () => {
    navigate(loginSuccessHref(location.search), { replace: true })
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    finishLogin()
  })

  /** 中文注释：账号密码登录成功后复用统一跳转逻辑，避免不同入口表现不一致。 */
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const ok = await auth.login({
      username: username().trim(),
      password: password(),
    })
    setPending(false)
    if (!ok) {
      setError(loginErrorText(auth.lastError()))
      return
    }
    finishLogin()
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (auth.authenticated()) return
    if (auto()) return
    const input = vhoInput()
    if (!input) return
    setAuto(true)
    setPending(true)
    setError("")
    void auth.loginVho(input).then((ok) => {
      setPending(false)
      if (!ok) {
        setError(loginErrorText(auth.lastError()))
        return
      }
      finishLogin()
    })
  })

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">TpCode 账号登录</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="用户名"
          value={username()}
          onInput={(event) => setUsername(event.currentTarget.value)}
          autocomplete="username"
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="密码"
          type="password"
          value={password()}
          onInput={(event) => setPassword(event.currentTarget.value)}
          autocomplete="current-password"
        />
        <Show when={error()}>
          <div class="text-12-regular text-icon-critical-base">{error()}</div>
        </Show>
        <Button type="submit" disabled={pending() || !username().trim() || !password()}>
          {pending() ? "登录中..." : "登录"}
        </Button>
        <div class="flex items-center justify-between text-12-regular text-text-weak">
          <A href="/register" class="hover:text-text-strong">
            注册账号
          </A>
          <A href="/password/forgot" class="hover:text-text-strong">
            忘记密码
          </A>
        </div>
      </form>
    </div>
  )
}
