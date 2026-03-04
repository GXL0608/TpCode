import { Button } from "@opencode-ai/ui/button"
import { A, useNavigate } from "@solidjs/router"
import { Show, createMemo, createSignal } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { passwordError, passwordRule } from "@/utils/account-rule"

export default function AccountReset() {
  const auth = useAccountAuth()
  const navigate = useNavigate()
  const [username, setUsername] = createSignal("")
  const [code, setCode] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const passwordIssue = createMemo(() => passwordError(password()))

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const ok = await auth.forgotReset({
      username: username().trim(),
      code: code().trim(),
      new_password: password(),
    })
    setPending(false)
    if (!ok) {
      setError("重置失败，请确认用户名与重置码")
      return
    }
    navigate("/login")
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">重置密码</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="用户名"
          value={username()}
          onInput={(event) => setUsername(event.currentTarget.value)}
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="重置码"
          value={code()}
          onInput={(event) => setCode(event.currentTarget.value)}
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="新密码"
          type="password"
          value={password()}
          onInput={(event) => setPassword(event.currentTarget.value)}
          autocomplete="new-password"
        />
        <div class="text-12-regular text-text-weak">{passwordRule}</div>
        <Show when={password()}>
          <div class={`text-12-regular ${passwordIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
            {passwordIssue() || "密码格式正确"}
          </div>
        </Show>
        {error() && <div class="text-12-regular text-icon-critical-base">{error()}</div>}
        <Button type="submit" disabled={pending() || !username().trim() || !code().trim() || !password() || !!passwordIssue()}>
          {pending() ? "重置中..." : "确认重置"}
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
