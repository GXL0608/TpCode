import { Button } from "@opencode-ai/ui/button"
import { A } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"

export default function AccountForgot() {
  const auth = useAccountAuth()
  const [username, setUsername] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [code, setCode] = createSignal("")
  const [error, setError] = createSignal("")

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const result = await auth.forgotRequest({ username: username().trim() })
    setPending(false)
    if (!result) {
      setError("重置请求失败")
      return
    }
    setCode(result)
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">申请找回密码</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="用户名"
          value={username()}
          onInput={(event) => setUsername(event.currentTarget.value)}
          autocomplete="username"
        />
        <Button type="submit" disabled={pending() || !username().trim()}>
          {pending() ? "提交中..." : "获取重置码"}
        </Button>
        <Show when={error()}>
          <div class="text-12-regular text-icon-critical-base">{error()}</div>
        </Show>
        <Show when={code()}>
          <div class="text-12-regular text-text-weak">
            重置码：<span class="text-text-strong">{code()}</span>
          </div>
        </Show>
        <div class="flex items-center justify-between text-12-regular text-text-weak">
          <A href="/password/reset" class="hover:text-text-strong">
            去重置密码
          </A>
          <A href="/login" class="hover:text-text-strong">
            返回登录
          </A>
        </div>
      </form>
    </div>
  )
}
