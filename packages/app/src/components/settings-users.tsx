import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { type AccountRole, type AccountUser, accountTypeZh, roleZh, statusZh } from "./settings-rbac-zh"

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

export const SettingsUsers = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const canManage = createMemo(() => auth.has("user:manage"))
  const canRole = createMemo(() => auth.has("role:manage"))

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    query: "",
    users: [] as AccountUser[],
    roles: [] as AccountRole[],
    createOpen: false,
    createUsername: "",
    createDisplayName: "",
    createPassword: "",
    createType: "internal" as "internal" | "hospital" | "partner",
    createRoles: [] as string[],
    editOpen: false,
    editUserID: "",
    editDisplayName: "",
    editEmail: "",
    editPhone: "",
    editStatus: "active" as "active" | "inactive",
    roleOpen: false,
    roleUserID: "",
    roleCodes: [] as string[],
  })

  const editUser = createMemo(() => state.users.find((item) => item.id === state.editUserID))
  const roleUser = createMemo(() => state.users.find((item) => item.id === state.roleUserID))

  const toggleCreateRole = (code: string) => {
    if (state.createRoles.includes(code)) {
      setState("createRoles", (current) => current.filter((item) => item !== code))
      return
    }
    setState("createRoles", (current) => [...current, code])
  }

  const resetCreate = () => {
    setState("createOpen", false)
    setState("createUsername", "")
    setState("createDisplayName", "")
    setState("createPassword", "")
    setState("createType", "internal")
    setState("createRoles", [])
  }

  const toggleRole = (code: string) => {
    if (state.roleCodes.includes(code)) {
      setState("roleCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("roleCodes", (current) => [...current, code])
  }

  const pathUsers = () => {
    const keyword = state.query.trim()
    if (!keyword) return "/account/admin/users"
    const query = new URLSearchParams({ keyword })
    return `/account/admin/users?${query.toString()}`
  }

  const load = async () => {
    if (!canManage()) return
    setState("loading", true)
    setState("error", "")

    const usersResponse = await request({ path: pathUsers() }).catch(() => undefined)
    const rolesResponse = canRole() ? await request({ path: "/account/admin/roles" }).catch(() => undefined) : undefined

    if (!usersResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(usersResponse))
      return
    }

    const users = list<AccountUser>(await usersResponse.json().catch(() => undefined))
    const roles = rolesResponse?.ok ? list<AccountRole>(await rolesResponse.json().catch(() => undefined)) : []

    setState("users", users)
    setState("roles", roles)
    setState("loading", false)
  }

  const openEdit = (item: AccountUser) => {
    setState("editOpen", true)
    setState("editUserID", item.id)
    setState("editDisplayName", item.display_name ?? "")
    setState("editEmail", item.email ?? "")
    setState("editPhone", item.phone ?? "")
    setState("editStatus", item.status === "inactive" ? "inactive" : "active")
  }

  const closeEdit = () => {
    if (state.pending) return
    setState("editOpen", false)
    setState("editUserID", "")
    setState("editDisplayName", "")
    setState("editEmail", "")
    setState("editPhone", "")
    setState("editStatus", "active")
  }

  const saveEdit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.editUserID) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")

    const response = await request({
      method: "PATCH",
      path: `/account/admin/users/${encodeURIComponent(state.editUserID)}`,
      body: {
        display_name: state.editDisplayName.trim(),
        email: state.editEmail.trim(),
        phone: state.editPhone.trim(),
        status: state.editStatus,
      },
    }).catch(() => undefined)

    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }

    setState("message", "用户信息已更新")
    closeEdit()
    await load()
  }

  const openRole = (item: AccountUser) => {
    if (!canRole()) return
    setState("roleOpen", true)
    setState("roleUserID", item.id)
    setState("roleCodes", item.roles.slice())
  }

  const closeRole = () => {
    if (state.pending) return
    setState("roleOpen", false)
    setState("roleUserID", "")
    setState("roleCodes", [])
  }

  const saveRole = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!canRole()) return
    if (!state.roleUserID) return

    setState("pending", true)
    setState("message", "")
    setState("error", "")

    const response = await request({
      method: "POST",
      path: `/account/admin/users/${encodeURIComponent(state.roleUserID)}/roles`,
      body: {
        role_codes: state.roleCodes,
      },
    }).catch(() => undefined)

    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }

    setState("message", "用户角色已更新")
    closeRole()
    await load()
  }

  const createUser = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!canManage()) return

    const orgID = auth.user()?.org_id
    if (!orgID) {
      setState("error", "当前账号缺少组织信息，无法创建用户")
      return
    }

    setState("pending", true)
    setState("message", "")
    setState("error", "")

    const response = await request({
      method: "POST",
      path: "/account/admin/users",
      body: {
        username: state.createUsername.trim(),
        password: state.createPassword,
        display_name: state.createDisplayName.trim() || undefined,
        account_type: state.createType,
        org_id: orgID,
        role_codes: canRole() ? state.createRoles : undefined,
        force_password_reset: true,
      },
    }).catch(() => undefined)

    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }

    setState("message", "用户创建成功")
    resetCreate()
    await load()
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canManage()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有用户管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-18-medium text-text-strong">用户管理</div>
              <div class="text-12-regular text-text-weak mt-1">管理系统用户并查看角色分配情况</div>
            </div>
            <div class="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
                刷新
              </Button>
              <Button type="button" onClick={() => setState("createOpen", true)}>
                新增用户
              </Button>
            </div>
          </div>

          <form
            class="rounded-xl border border-border-weak-base bg-surface-base p-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void load()
            }}
          >
            <input
              class="h-10 flex-1 rounded-md border border-border-weak-base bg-background-base px-3 text-14-regular"
              placeholder="按用户名或显示名搜索"
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
            />
            <Button type="submit" variant="secondary" disabled={state.loading}>
              查询
            </Button>
          </form>

          <Show when={state.message}>
            <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
          </Show>
          <Show when={state.error}>
            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
          </Show>

          <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong flex items-center justify-between">
              <span>用户列表</span>
              <Show when={state.loading}>
                <span class="text-12-regular text-text-weak">加载中...</span>
              </Show>
            </div>
            <div class="max-h-[460px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">用户名</th>
                    <th class="text-left px-3 py-2">显示名</th>
                    <th class="text-left px-3 py-2">账号类型</th>
                    <th class="text-left px-3 py-2">状态</th>
                    <th class="text-left px-3 py-2">角色</th>
                    <th class="text-left px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.users}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base hover:bg-surface-panel/45 transition-colors">
                        <td class="px-3 py-2">{item.username}</td>
                        <td class="px-3 py-2">{item.display_name}</td>
                        <td class="px-3 py-2">{accountTypeZh(item.account_type)}</td>
                        <td class="px-3 py-2">{statusZh(item.status)}</td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-1.5">
                            <For each={item.roles.length > 0 ? item.roles : ["-"]}>
                              {(code) => (
                                <span class="rounded-full border border-border-weak-base bg-surface-panel px-2.5 py-0.5 text-11-medium text-text-weak">
                                  {roleZh(code)}
                                </span>
                              )}
                            </For>
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-1.5">
                            <Button type="button" size="small" variant="secondary" onClick={() => openEdit(item)}>
                              编辑
                            </Button>
                            <Show when={canRole()}>
                              <Button type="button" size="small" variant="secondary" onClick={() => openRole(item)}>
                                分配角色
                              </Button>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.users.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={6}>
                        暂无用户数据
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </Show>

      <Show when={state.createOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-lg rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={createUser}>
            <div class="text-16-medium text-text-strong">新增用户</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="用户名"
              value={state.createUsername}
              onInput={(event) => setState("createUsername", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="显示名（可选）"
              value={state.createDisplayName}
              onInput={(event) => setState("createDisplayName", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              type="password"
              placeholder="初始密码"
              value={state.createPassword}
              onInput={(event) => setState("createPassword", event.currentTarget.value)}
            />
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={state.createType}
              onChange={(event) => setState("createType", event.currentTarget.value as "internal" | "hospital" | "partner")}
            >
              <option value="internal">内部账号</option>
              <option value="hospital">医院账号</option>
              <option value="partner">合作方账号</option>
            </select>

            <Show when={canRole()}>
              <div class="rounded-md border border-border-weak-base bg-surface-panel p-3">
                <div class="text-12-medium text-text-weak mb-2">初始角色</div>
                <div class="flex flex-wrap gap-2">
                  <For each={state.roles}>
                    {(role) => (
                      <label class="inline-flex items-center gap-2 rounded-full border border-border-weak-base bg-surface-base px-3 py-1.5 text-12-regular">
                        <input
                          type="checkbox"
                          checked={state.createRoles.includes(role.code)}
                          onChange={() => toggleCreateRole(role.code)}
                        />
                        <span>{roleZh(role.code)}</span>
                      </label>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={resetCreate} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending || !state.createUsername.trim() || !state.createPassword}>
                {state.pending ? "创建中..." : "确认创建"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.editOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-lg rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveEdit}>
            <div class="text-16-medium text-text-strong">编辑用户</div>
            <div class="text-12-regular text-text-weak">用户名：{editUser()?.username ?? "-"}</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="显示名"
              value={state.editDisplayName}
              onInput={(event) => setState("editDisplayName", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="邮箱（可留空）"
              value={state.editEmail}
              onInput={(event) => setState("editEmail", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="手机号（可留空）"
              value={state.editPhone}
              onInput={(event) => setState("editPhone", event.currentTarget.value)}
            />
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={state.editStatus}
              onChange={(event) => setState("editStatus", event.currentTarget.value as "active" | "inactive")}
            >
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
            </select>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeEdit} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending || !state.editDisplayName.trim()}>
                {state.pending ? "保存中..." : "保存修改"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.roleOpen && canRole()}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveRole}>
            <div class="text-16-medium text-text-strong">分配角色</div>
            <div class="text-12-regular text-text-weak">
              目标用户：{roleUser()?.display_name || roleUser()?.username || "-"}（{roleUser()?.username || "-"}）
            </div>
            <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 max-h-[320px] overflow-auto">
              <div class="flex flex-wrap gap-2">
                <For each={state.roles}>
                  {(role) => (
                    <label class="inline-flex items-center gap-2 rounded-full border border-border-weak-base bg-surface-base px-3 py-1.5 text-12-regular">
                      <input type="checkbox" checked={state.roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} />
                      <span>{roleZh(role.code)}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeRole} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存角色"}
              </Button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  )
}
