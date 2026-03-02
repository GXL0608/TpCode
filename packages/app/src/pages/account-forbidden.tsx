import { Button } from "@opencode-ai/ui/button"
import { A } from "@solidjs/router"

export default function AccountForbidden() {
  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <div class="w-full max-w-md flex flex-col gap-4 bg-surface-raised-base rounded-xl p-6">
        <div class="text-20-medium text-text-strong">403 无权限访问</div>
        <div class="text-14-regular text-text-weak">当前账号没有访问该页面的权限。</div>
        <div class="flex items-center gap-2">
          <Button as={A} href="/">
            返回应用
          </Button>
          <Button as={A} href="/settings/security" variant="secondary">
            账号安全
          </Button>
        </div>
      </div>
    </div>
  )
}
