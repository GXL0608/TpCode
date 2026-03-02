import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { For, Show, createSignal } from "solid-js"
import { useAccountAuth } from "@/context/account-auth"
import { accountTypeZh, roleZh } from "./settings-rbac-zh"

export const SettingsAccount = () => {
  const auth = useAccountAuth()
  const dialog = useDialog()
  const navigate = useNavigate()

  const [passwordOpen, setPasswordOpen] = createSignal(false)
  const [passwordCurrent, setPasswordCurrent] = createSignal("")
  const [passwordNext, setPasswordNext] = createSignal("")
  const [passwordPending, setPasswordPending] = createSignal(false)
  const [passwordError, setPasswordError] = createSignal("")
  const [passwordMessage, setPasswordMessage] = createSignal("")

  const submitPassword = async (event: SubmitEvent) => {
    event.preventDefault()
    setPasswordPending(true)
    setPasswordError("")
    setPasswordMessage("")
    const result = await auth.changePassword({
      current_password: passwordCurrent(),
      new_password: passwordNext(),
    })
    setPasswordPending(false)
    if (!result.ok) {
      if (result.code === "password_invalid") {
        setPasswordError("当前密码错误")
        return
      }
      if (result.code === "new_password_invalid") {
        setPasswordError("新密码至少需要 8 位")
        return
      }
      setPasswordError("修改密码失败")
      return
    }
    setPasswordCurrent("")
    setPasswordNext("")
    setPasswordMessage("密码修改成功")
  }

  const logout = async () => {
    dialog.close()
    await auth.logout()
    navigate("/login", { replace: true })
  }

  const closePassword = () => {
    if (passwordPending()) return
    setPasswordOpen(false)
    setPasswordCurrent("")
    setPasswordNext("")
    setPasswordError("")
    setPasswordMessage("")
  }

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-18-medium text-text-strong">我的</div>
            <div class="text-12-regular text-text-weak mt-1">当前登录账号信息与个人安全设置</div>
          </div>
          <Show when={auth.user()?.force_password_reset}>
            <span class="rounded-full border border-icon-critical-base/25 bg-icon-critical-base/10 px-3 py-1 text-11-medium text-icon-critical-base">
              需修改密码
            </span>
          </Show>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div class="rounded-xl border border-border-weak-base bg-surface-base p-3">
            <div class="text-11-regular text-text-weak">用户名</div>
            <div class="text-14-medium text-text-strong mt-1">{auth.user()?.username ?? "-"}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-surface-base p-3">
            <div class="text-11-regular text-text-weak">显示名</div>
            <div class="text-14-medium text-text-strong mt-1">{auth.user()?.display_name ?? "-"}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-surface-base p-3">
            <div class="text-11-regular text-text-weak">账号类型</div>
            <div class="text-14-medium text-text-strong mt-1">{accountTypeZh(auth.user()?.account_type)}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-surface-base p-3">
            <div class="text-11-regular text-text-weak">角色</div>
            <div class="flex flex-wrap gap-1.5 mt-1">
              <For each={auth.user()?.roles ?? []}>
                {(role) => (
                  <span class="rounded-full border border-border-weak-base bg-surface-panel px-2.5 py-0.5 text-11-medium text-text-weak">
                    {roleZh(role)}
                  </span>
                )}
              </For>
              <Show when={(auth.user()?.roles ?? []).length === 0}>
                <span class="text-14-medium text-text-strong">-</span>
              </Show>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setPasswordOpen(true)}>
          修改密码
        </Button>
        <Button type="button" variant="secondary" onClick={logout}>
          退出登录
        </Button>
      </section>

      <Show when={passwordOpen()}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-md rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={submitPassword}>
            <div class="text-16-medium text-text-strong">修改密码</div>
            <div class="text-12-regular text-text-weak">密码规则：至少 8 位</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              type="password"
              placeholder="当前密码"
              value={passwordCurrent()}
              onInput={(event) => setPasswordCurrent(event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              type="password"
              placeholder="新密码"
              value={passwordNext()}
              onInput={(event) => setPasswordNext(event.currentTarget.value)}
            />
            <Show when={passwordError()}>
              <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{passwordError()}</div>
            </Show>
            <Show when={passwordMessage()}>
              <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{passwordMessage()}</div>
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closePassword} disabled={passwordPending()}>
                取消
              </Button>
              <Button type="submit" disabled={passwordPending() || !passwordCurrent() || !passwordNext()}>
                {passwordPending() ? "保存中..." : "确认修改"}
              </Button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  )
}
