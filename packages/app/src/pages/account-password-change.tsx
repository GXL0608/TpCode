import { Button } from "@opencode-ai/ui/button"
import { A, useNavigate } from "@solidjs/router"
import { Show, createMemo, createSignal } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { passwordError, passwordRule } from "@/utils/account-rule"

export default function AccountPasswordChange() {
  const auth = useAccountAuth()
  const navigate = useNavigate()
  const canAdmin = createMemo(() => {
    return (
      auth.has("org:manage") ||
      auth.has("user:manage") ||
      auth.has("role:manage") ||
      auth.has("audit:view") ||
      auth.has("provider:config_global")
    )
  })
  const [currentPassword, setCurrentPassword] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [ok, setOk] = createSignal(false)
  const newPasswordIssue = createMemo(() => passwordError(newPassword()))

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setPending(true)
    setError("")
    setOk(false)
    const result = await auth.changePassword({
      current_password: currentPassword(),
      new_password: newPassword(),
    })
    setPending(false)
    if (!result.ok) {
      if (result.code === "password_invalid") {
        setError("当前密码错误")
        return
      }
      if (result.code === "new_password_invalid") {
        setError(passwordRule)
        return
      }
      setError("修改密码失败")
      return
    }
    setCurrentPassword("")
    setNewPassword("")
    setOk(true)
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <form class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6" onSubmit={submit}>
        <div class="text-20-medium text-text-strong">修改密码</div>
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="当前密码"
          type="password"
          value={currentPassword()}
          onInput={(event) => setCurrentPassword(event.currentTarget.value)}
        />
        <input
          class="h-11 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
          placeholder="新密码"
          type="password"
          value={newPassword()}
          onInput={(event) => setNewPassword(event.currentTarget.value)}
        />
        <div class="text-12-regular text-text-weak">{passwordRule}</div>
        <Show when={newPassword()}>
          <div class={`text-12-regular ${newPasswordIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
            {newPasswordIssue() || "密码格式正确"}
          </div>
        </Show>
        {error() && <div class="text-12-regular text-icon-critical-base">{error()}</div>}
        {ok() && <div class="text-12-regular text-icon-success-base">密码修改成功</div>}
        <Button type="submit" disabled={pending() || !currentPassword() || !newPassword() || !!newPasswordIssue()}>
          {pending() ? "保存中..." : "确认修改"}
        </Button>
        <div class="flex items-center justify-between text-12-regular text-text-weak">
          <A href="/approval" class="hover:text-text-strong">
            审批流
          </A>
          <Show when={canAdmin()}>
            <A href="/settings/account-admin" class="hover:text-text-strong">
              账号管理
            </A>
          </Show>
          <A href="/" class="hover:text-text-strong">
            返回应用
          </A>
          <button
            type="button"
            class="hover:text-text-strong"
            onClick={async () => {
              await auth.logout()
              navigate("/login")
            }}
          >
            退出登录
          </button>
        </div>
      </form>
    </div>
  )
}
