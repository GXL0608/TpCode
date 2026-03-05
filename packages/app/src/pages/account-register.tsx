import { Button } from "@opencode-ai/ui/button"
import { A, useNavigate } from "@solidjs/router"
import { Show, createMemo, createSignal } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { passwordError, passwordRule, phoneError, phoneRule } from "@/utils/account-rule"

export default function AccountRegister() {
  const auth = useAccountAuth()
  const navigate = useNavigate()
  const [username, setUsername] = createSignal("")
  const [displayName, setDisplayName] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [phone, setPhone] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const passwordIssue = createMemo(() => passwordError(password()))
  const phoneIssue = createMemo(() => phoneError(phone()))

  const registerErrorText = (code?: string) => {
    if (code === "password_invalid") return passwordRule
    if (code === "username_exists") return "用户名已存在"
    if (code === "phone_invalid") return phoneRule
    if (code === "register_closed") return "注册功能已关闭"
    if (code === "account_disabled") return "账号系统未启用"
    return "注册失败，请检查输入信息"
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const ok = await auth.register({
      username: username().trim(),
      display_name: displayName().trim() || undefined,
      password: password(),
      phone: phone().trim(),
    })
    setPending(false)
    if (!ok) {
      setError(registerErrorText(auth.lastError()))
      return
    }
    navigate("/login")
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">TpCode 注册账号</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="用户名"
          value={username()}
          onInput={(event) => setUsername(event.currentTarget.value)}
          autocomplete="username"
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="显示名称（可选）"
          value={displayName()}
          onInput={(event) => setDisplayName(event.currentTarget.value)}
          autocomplete="name"
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="密码"
          type="password"
          value={password()}
          onInput={(event) => setPassword(event.currentTarget.value)}
          autocomplete="new-password"
        />
        <Show when={password()}>
          <div class={`text-12-regular ${passwordIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
            {passwordIssue() || "密码格式正确"}
          </div>
        </Show>
        <Show when={!password()}>
          <div class="text-12-regular text-text-weak">{passwordRule}</div>
        </Show>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="手机号"
          value={phone()}
          onInput={(event) => setPhone(event.currentTarget.value)}
          autocomplete="tel"
        />
        <Show when={phone()}>
          <div class={`text-12-regular ${phoneIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
            {phoneIssue() || "手机号格式正确"}
          </div>
        </Show>
        <Show when={!phone()}>
          <div class="text-12-regular text-text-weak">{phoneRule}</div>
        </Show>
        {error() && <div class="text-12-regular text-icon-critical-base">{error()}</div>}
        <Button
          type="submit"
          disabled={pending() || !username().trim() || !password() || !!passwordIssue() || !phone().trim() || !!phoneIssue()}
        >
          {pending() ? "注册中..." : "注册"}
        </Button>
        <div class="text-12-regular text-text-weak">
          <A href="/login" class="hover:text-text-strong">
            返回登录
          </A>
        </div>
      </form>
    </div>
  )
}
