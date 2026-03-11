import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { passwordError, passwordRule, phoneError, phoneRule } from "@/utils/account-rule"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { filterRoles } from "./settings-users-filter"
import { createUserLayout } from "./settings-users-layout"
import { type AccountRole, type AccountUser, roleZh } from "./settings-rbac-zh"

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function page<T>(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const row = input as {
    items?: unknown
    total?: unknown
    page?: unknown
    page_size?: unknown
  }
  if (!Array.isArray(row.items)) return
  return {
    items: row.items as T[],
    total: typeof row.total === "number" ? row.total : Number(row.total ?? 0),
    page: typeof row.page === "number" ? row.page : Number(row.page ?? 1),
    page_size: typeof row.page_size === "number" ? row.page_size : Number(row.page_size ?? 15),
  }
}

const pageSizes = [10, 20, 50, 100, 500] as const

export const SettingsUsers = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const layout = createUserLayout()
  const canView = createMemo(() => auth.has("user:manage"))
  const canManage = createMemo(() => auth.has("user:manage"))
  const canRole = createMemo(() => auth.has("role:manage"))

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    query: "",
    userPage: 1,
    userJump: "1",
    userPageSize: 20,
    userTotal: 0,
    users: [] as AccountUser[],
    roles: [] as AccountRole[],
    createOpen: false,
    createUsername: "",
    createDisplayName: "",
    createPassword: "",
    createPhone: "",
    createType: "internal" as "internal" | "hospital" | "partner",
    createRoleQuery: "",
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
  const roleMap = createMemo(() => new Map(state.roles.map((item) => [item.code, item])))
  const createPasswordIssue = createMemo(() => passwordError(state.createPassword))
  const createPhoneIssue = createMemo(() => phoneError(state.createPhone))
  const filteredCreateRoles = createMemo(() => filterRoles(state.roles, state.createRoleQuery))
  const userPageTotal = createMemo(() => Math.max(1, Math.ceil(state.userTotal / state.userPageSize)))
  const userRangeStart = createMemo(() => {
    if (state.userTotal === 0 || state.users.length === 0) return 0
    return (state.userPage - 1) * state.userPageSize + 1
  })
  const userRangeEnd = createMemo(() => {
    const start = userRangeStart()
    if (start === 0) return 0
    return start + state.users.length - 1
  })
  const roleName = (code: string) => roleMap().get(code)?.name?.trim() || roleZh(code)
  const roleText = (codes: string[]) => (codes.length > 0 ? codes.map(roleName).join("、") : "-")

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
    setState("createPhone", "")
    setState("createType", "internal")
    setState("createRoleQuery", "")
    setState("createRoles", [])
  }

  const toggleRole = (code: string) => {
    if (state.roleCodes.includes(code)) {
      setState("roleCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("roleCodes", (current) => [...current, code])
  }

  const pathUsers = (pageID: number, pageSize: number) => {
    const keyword = state.query.trim()
    const query = new URLSearchParams({
      page: String(pageID),
      page_size: String(pageSize),
    })
    if (keyword) query.set("keyword", keyword)
    return `/account/admin/users?${query.toString()}`
  }

  const load = async (input?: { page?: number; pageSize?: number }) => {
    if (!canView()) return
    setState("loading", true)
    setState("error", "")
    const pageID = input?.page ?? state.userPage
    const pageSize = input?.pageSize ?? state.userPageSize

    const usersResponse = await request({ path: pathUsers(pageID, pageSize) }).catch(() => undefined)
    const rolesResponse = canRole() ? await request({ path: "/account/admin/roles" }).catch(() => undefined) : undefined

    if (!usersResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(usersResponse))
      return
    }

    const usersBody = await usersResponse.json().catch(() => undefined)
    const usersPage = page<AccountUser>(usersBody)
    const users = usersPage ? list<AccountUser>(usersPage.items) : list<AccountUser>(usersBody)
    const rolesBody = rolesResponse?.ok ? await rolesResponse.json().catch(() => undefined) : undefined
    const rolesPage = page<AccountRole>(rolesBody)
    const roles = rolesPage ? list<AccountRole>(rolesPage.items) : list<AccountRole>(rolesBody)

    setState("users", users)
    setState("userPage", Math.max(1, usersPage?.page ?? pageID))
    setState("userJump", String(Math.max(1, usersPage?.page ?? pageID)))
    setState("userPageSize", Math.max(1, usersPage?.page_size ?? pageSize))
    setState("userTotal", Math.max(0, usersPage?.total ?? users.length))
    setState("roles", roles)
    setState("loading", false)
  }

  const loadUserPage = async () => {
    const next = Number(state.userJump.trim())
    if (!Number.isFinite(next)) {
      setState("userJump", String(state.userPage))
      return
    }
    await load({ page: Math.min(userPageTotal(), Math.max(1, Math.floor(next))) })
  }

  const loadUserPageSize = async (pageSize: number) => {
    setState("userPageSize", pageSize)
    setState("userJump", "1")
    await load({ page: 1, pageSize })
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
    await auth.reload()
  }

  const resetPassword = async (item: AccountUser) => {
    if (!canManage()) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "POST",
      path: `/account/admin/users/${encodeURIComponent(item.id)}/password/reset`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", `已重置 ${item.username} 的密码为 TpCode@2026`)
  }

  const removeUser = async (item: AccountUser) => {
    if (!canManage()) return
    const name = item.display_name || item.username
    const ok = globalThis.confirm(`确认删除成员「${name}」？\n\n删除后将同时移除该成员的登录账号、角色绑定、项目权限和模型配置，且无法恢复。`)
    if (!ok) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/users/${encodeURIComponent(item.id)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", `已删除成员 ${name}`)
    const page = state.users.length === 1 && state.userPage > 1 ? state.userPage - 1 : state.userPage
    await load({ page })
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
        phone: state.createPhone.trim(),
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
        when={canView()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有用户列表权限
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
              <Show when={canManage()}>
                <Button type="button" onClick={() => setState("createOpen", true)}>
                  新增用户
                </Button>
              </Show>
            </div>
          </div>

          <form
            class="rounded-xl border border-border-weak-base bg-surface-base p-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void load({ page: 1 })
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
            <div class="max-h-[560px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">用户名</th>
                    <th class="text-left px-3 py-2">姓名</th>
                    <th class="text-left px-3 py-2">客户</th>
                    <th class="text-left px-3 py-2">部门</th>
                    <th class="text-left px-3 py-2">角色</th>
                    <th class="w-16 text-center px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.users}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base hover:bg-surface-panel/45 transition-colors">
                        <td class="px-3 py-2 text-12-medium text-text-strong">{item.username}</td>
                        <td class="px-3 py-2 text-text-weak">{item.display_name || "-"}</td>
                        <td class="px-3 py-2 text-text-weak">{item.customer_name || "-"}</td>
                        <td class="px-3 py-2 text-text-weak">{item.customer_department_name || "-"}</td>
                        <td class="px-3 py-2">
                          <div class="max-w-[320px] truncate text-text-weak" title={roleText(item.roles)}>
                            {roleText(item.roles)}
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <div class="flex justify-center">
                            <DropdownMenu gutter={4} placement="bottom-end">
                              <DropdownMenu.Trigger
                                as={IconButton}
                                icon="dot-grid"
                                variant="ghost"
                                class="size-7 rounded-md data-[expanded]:bg-surface-base-active"
                                aria-label={`管理用户 ${item.username}`}
                              />
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content>
                                  <DropdownMenu.Item onSelect={() => openEdit(item)}>
                                    <DropdownMenu.ItemLabel>编辑</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <Show when={canRole()}>
                                    <DropdownMenu.Item onSelect={() => openRole(item)}>
                                      <DropdownMenu.ItemLabel>分配角色</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                  </Show>
                                  <DropdownMenu.Item onSelect={() => void resetPassword(item)} disabled={state.pending}>
                                    <DropdownMenu.ItemLabel>重置密码</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item
                                    onSelect={() => void removeUser(item)}
                                    disabled={state.pending || item.id === auth.user()?.id || item.id === "user_tp_admin"}
                                  >
                                    <DropdownMenu.ItemLabel>删除成员</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
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
            <div class="px-4 py-3 border-t border-border-weak-base bg-surface-panel/35 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div class="text-12-regular text-text-weak">
                第 {state.userPage} / {userPageTotal()} 页，共 {state.userTotal} 条（当前 {userRangeStart()}-{userRangeEnd()}）
              </div>
              <div class="flex flex-col gap-2 md:flex-row md:items-center">
                <div class="flex items-center gap-2">
                  <span class="text-12-regular text-text-weak">每页</span>
                  <select
                    class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular"
                    value={String(state.userPageSize)}
                    onChange={(event) => void loadUserPageSize(Number(event.currentTarget.value))}
                  >
                    <For each={pageSizes}>{(item) => <option value={item}>{item}</option>}</For>
                  </select>
                  <span class="text-12-regular text-text-weak">条</span>
                </div>
                <form
                  class="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void loadUserPage()
                  }}
                >
                  <span class="text-12-regular text-text-weak">跳到</span>
                  <input
                    class="h-8 w-20 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular"
                    inputMode="numeric"
                    value={state.userJump}
                    onInput={(event) => setState("userJump", event.currentTarget.value)}
                  />
                  <span class="text-12-regular text-text-weak">页</span>
                  <Button type="submit" size="small" variant="secondary" disabled={state.loading}>
                    跳转
                  </Button>
                </form>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={state.loading || state.userPage <= 1}
                  onClick={() => void load({ page: state.userPage - 1 })}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={state.loading || state.userPage >= userPageTotal()}
                  onClick={() => void load({ page: state.userPage + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Show>

      <Show when={state.createOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class={layout.dialog} onSubmit={createUser}>
            <div class={layout.body}>
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
              <Show when={state.createPassword}>
                <div class={`text-12-regular ${createPasswordIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
                  {createPasswordIssue() || "密码格式正确"}
                </div>
              </Show>
              <Show when={!state.createPassword}>
                <div class="text-12-regular text-text-weak">{passwordRule}</div>
              </Show>
              <input
                class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                placeholder="手机号"
                value={state.createPhone}
                onInput={(event) => setState("createPhone", event.currentTarget.value)}
              />
              <Show when={state.createPhone}>
                <div class={`text-12-regular ${createPhoneIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
                  {createPhoneIssue() || "手机号格式正确"}
                </div>
              </Show>
              <Show when={!state.createPhone}>
                <div class="text-12-regular text-text-weak">{phoneRule}</div>
              </Show>
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
                <div class={layout.rolePanel}>
                  <div class="text-12-medium text-text-weak mb-2">初始角色</div>
                  <input
                    class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular mb-2"
                    placeholder="搜索角色名称或编码"
                    value={state.createRoleQuery}
                    onInput={(event) => setState("createRoleQuery", event.currentTarget.value)}
                  />
                  <div class={layout.roleList}>
                    <For each={filteredCreateRoles()}>
                      {(role) => (
                        <label class={layout.roleItem}>
                          <input
                            type="checkbox"
                            checked={state.createRoles.includes(role.code)}
                            onChange={() => toggleCreateRole(role.code)}
                          />
                          <span>{role.name?.trim() || roleZh(role.code)}</span>
                        </label>
                      )}
                    </For>
                  </div>
                  <Show when={filteredCreateRoles().length === 0}>
                    <div class="py-6 text-center text-12-regular text-text-weak">未找到匹配角色</div>
                  </Show>
                </div>
              </Show>
            </div>

            <div class={layout.footer}>
              <Button type="button" variant="secondary" onClick={resetCreate} disabled={state.pending}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  state.pending ||
                  !state.createUsername.trim() ||
                  !state.createPassword ||
                  !!createPasswordIssue() ||
                  !state.createPhone.trim() ||
                  !!createPhoneIssue()
                }
              >
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
            <div class="grid grid-cols-2 gap-2 rounded-md border border-border-weak-base bg-surface-panel p-3">
              <div class="min-w-0">
                <div class="text-11-regular text-text-weak">客户</div>
                <div class="truncate text-12-regular text-text-strong">{editUser()?.customer_name ?? "-"}</div>
              </div>
              <div class="min-w-0">
                <div class="text-11-regular text-text-weak">部门</div>
                <div class="truncate text-12-regular text-text-strong">{editUser()?.customer_department_name ?? "-"}</div>
              </div>
            </div>
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
                      <span>{role.name?.trim() || roleZh(role.code)}</span>
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
