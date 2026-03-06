import { Button } from "@opencode-ai/ui/button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { passwordError, passwordRule, phoneError, phoneRule } from "@/utils/account-rule"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { type AccountRole, type AccountUser, accountTypeZh, roleZh, statusZh } from "./settings-rbac-zh"

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

export const SettingsUsers = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const providers = useProviders()
  const canManage = createMemo(() => auth.has("user:manage"))
  const canRole = createMemo(() => auth.has("role:manage"))
  const canProviderUser = createMemo(() => auth.user()?.roles.includes("super_admin") ?? false)

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    query: "",
    userPage: 1,
    userPageSize: 15,
    userTotal: 0,
    users: [] as AccountUser[],
    roles: [] as AccountRole[],
    createOpen: false,
    createUsername: "",
    createDisplayName: "",
    createPassword: "",
    createPhone: "",
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
    providerOpen: false,
    providerUserID: "",
    providerUserName: "",
    providerID: "openai",
    providerKey: "",
    providerRows: [] as Array<{ provider_id: string; configured: boolean; auth_type?: string; has_config?: boolean; disabled?: boolean }>,
    providerModel: "",
    providerSmallModel: "",
    providerConfigText: "{}",
  })

  const editUser = createMemo(() => state.users.find((item) => item.id === state.editUserID))
  const roleUser = createMemo(() => state.users.find((item) => item.id === state.roleUserID))
  const providerCatalog = createMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const item of providers.all()) {
      map.set(item.id, {
        id: item.id,
        name: item.name?.trim() || item.id,
      })
    }
    for (const id of popularProviders) {
      if (map.has(id)) continue
      map.set(id, {
        id,
        name: id,
      })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  })
  const providerMap = createMemo(() => new Map(providerCatalog().map((item) => [item.id, item])))
  const configuredProviderIDs = createMemo(() => new Set(state.providerRows.map((item) => item.provider_id)))
  const providerPopular = createMemo(() =>
    popularProviders
      .map((id) => providerMap().get(id))
      .filter((item): item is { id: string; name: string } => !!item && !configuredProviderIDs().has(item.id)),
  )
  const providerAll = createMemo(() => providerCatalog().filter((item) => !configuredProviderIDs().has(item.id)))
  const providerName = (providerID: string) => providerMap().get(providerID)?.name ?? providerID
  const providerIcon = (providerID: string): IconName => {
    if (iconNames.includes(providerID as IconName)) return providerID as IconName
    return "synthetic"
  }
  const createPasswordIssue = createMemo(() => passwordError(state.createPassword))
  const createPhoneIssue = createMemo(() => phoneError(state.createPhone))
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
    setState("createRoles", [])
  }

  const toggleRole = (code: string) => {
    if (state.roleCodes.includes(code)) {
      setState("roleCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("roleCodes", (current) => [...current, code])
  }

  const pathUsers = (pageID: number) => {
    const keyword = state.query.trim()
    const query = new URLSearchParams({
      page: String(pageID),
      page_size: String(state.userPageSize),
    })
    if (keyword) query.set("keyword", keyword)
    return `/account/admin/users?${query.toString()}`
  }

  const load = async (input?: { page?: number }) => {
    if (!canManage()) return
    setState("loading", true)
    setState("error", "")
    const pageID = input?.page ?? state.userPage

    const usersResponse = await request({ path: pathUsers(pageID) }).catch(() => undefined)
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
    setState("userPageSize", Math.max(1, usersPage?.page_size ?? state.userPageSize))
    setState("userTotal", Math.max(0, usersPage?.total ?? users.length))
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

  const loadUserProviders = async (userID: string) => {
    const response = await request({
      path: `/account/admin/users/${encodeURIComponent(userID)}/providers`,
    }).catch(() => undefined)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const rows = list<{ provider_id: string; configured: boolean; auth_type?: string; has_config?: boolean; disabled?: boolean }>(
      await response.json().catch(() => undefined),
    )
    setState("providerRows", rows)
  }

  const loadUserProviderControl = async (userID: string) => {
    const response = await request({
      path: `/account/admin/users/${encodeURIComponent(userID)}/provider-control`,
    }).catch(() => undefined)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const row = (await response.json().catch(() => undefined)) as { model?: unknown; small_model?: unknown } | undefined
    setState("providerModel", typeof row?.model === "string" ? row.model : "")
    setState("providerSmallModel", typeof row?.small_model === "string" ? row.small_model : "")
  }

  const loadProviderConfig = async (userID: string, providerID: string) => {
    const response = await request({
      path: `/account/admin/users/${encodeURIComponent(userID)}/providers/${encodeURIComponent(providerID)}/config`,
    }).catch(() => undefined)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const row = (await response.json().catch(() => undefined)) as { config?: unknown } | undefined
    const text = row?.config ? JSON.stringify(row.config, null, 2) : "{}"
    setState("providerConfigText", text)
  }

  const openProvider = async (item: AccountUser) => {
    if (!canProviderUser()) return
    setState("providerOpen", true)
    setState("providerUserID", item.id)
    setState("providerUserName", item.display_name || item.username)
    setState("providerID", providerCatalog()[0]?.id ?? "openai")
    setState("providerKey", "")
    setState("providerRows", [])
    setState("providerModel", "")
    setState("providerSmallModel", "")
    setState("providerConfigText", "{}")
    await loadUserProviders(item.id)
    await loadUserProviderControl(item.id)
  }

  const closeProvider = () => {
    if (state.pending) return
    setState("providerOpen", false)
    setState("providerUserID", "")
    setState("providerUserName", "")
    setState("providerID", "openai")
    setState("providerKey", "")
    setState("providerRows", [])
    setState("providerModel", "")
    setState("providerSmallModel", "")
    setState("providerConfigText", "{}")
  }

  const saveProvider = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.providerUserID || !state.providerID.trim() || !state.providerKey.trim()) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "PUT",
      path: `/account/admin/users/${encodeURIComponent(state.providerUserID)}/providers/${encodeURIComponent(state.providerID.trim())}`,
      body: {
        type: "api",
        key: state.providerKey.trim(),
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("providerKey", "")
    setState("message", "用户供应商已更新")
    await loadUserProviders(state.providerUserID)
  }

  const removeProvider = async (providerID: string) => {
    if (!state.providerUserID) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/users/${encodeURIComponent(state.providerUserID)}/providers/${encodeURIComponent(providerID)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "用户供应商已删除")
    await loadUserProviders(state.providerUserID)
  }

  const saveProviderControl = async () => {
    if (!state.providerUserID) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "PUT",
      path: `/account/admin/users/${encodeURIComponent(state.providerUserID)}/provider-control`,
      body: {
        model: state.providerModel.trim() || undefined,
        small_model: state.providerSmallModel.trim() || undefined,
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "用户模型默认配置已更新")
  }

  const saveProviderConfig = async () => {
    if (!state.providerUserID || !state.providerID.trim()) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const parsed = await Promise.resolve().then(() => JSON.parse(state.providerConfigText || "{}") as Record<string, unknown>).catch(() => undefined)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setState("pending", false)
      setState("error", "提供商配置 JSON 格式无效")
      return
    }
    const response = await request({
      method: "PUT",
      path: `/account/admin/users/${encodeURIComponent(state.providerUserID)}/providers/${encodeURIComponent(state.providerID.trim())}/config`,
      body: parsed,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "用户供应商配置已更新")
    await loadUserProviders(state.providerUserID)
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

  createEffect(() => {
    if (!state.providerOpen) return
    if (!canProviderUser()) return
    if (!state.providerUserID) return
    const providerID = state.providerID.trim()
    if (!providerID) return
    void loadProviderConfig(state.providerUserID, providerID)
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
          <Show when={!canProviderUser()}>
            <div class="rounded-md bg-surface-panel px-3 py-2 text-12-regular text-text-weak">
              仅 super_admin 可为其他用户代管模型提供商与模型配置。
            </div>
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
                            <Button type="button" size="small" variant="secondary" onClick={() => void resetPassword(item)} disabled={state.pending}>
                              重置密码
                            </Button>
                            <Show when={canProviderUser()}>
                              <Button type="button" size="small" variant="secondary" onClick={() => void openProvider(item)}>
                                设置供应商
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
            <div class="px-4 py-3 border-t border-border-weak-base bg-surface-panel/35 flex items-center justify-between">
              <div class="text-12-regular text-text-weak">
                第 {state.userPage} / {userPageTotal()} 页，共 {state.userTotal} 条（当前 {userRangeStart()}-{userRangeEnd()}）
              </div>
              <div class="flex items-center gap-2">
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

      <Show when={state.providerOpen && canProviderUser()}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveProvider}>
            <div class="text-16-medium text-text-strong">设置供应商</div>
            <div class="text-12-regular text-text-weak">目标用户：{state.providerUserName || "-"}</div>
            <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 max-h-[260px] overflow-auto">
              <div class="text-12-medium text-text-weak mb-2">已配置供应商</div>
              <Show
                when={state.providerRows.length > 0}
                fallback={<div class="text-12-regular text-text-weak">暂无配置</div>}
              >
                <div class="flex flex-col gap-2">
                  <For each={state.providerRows}>
                    {(item) => (
                      <div class="flex items-center justify-between rounded-md border border-border-weak-base bg-surface-base px-3 py-2">
                        <div class="min-w-0 flex items-center gap-2">
                          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-base border border-border-weak-base">
                            <ProviderIcon id={providerIcon(item.provider_id)} class="size-4 icon-strong-base" />
                          </div>
                          <div class="min-w-0">
                            <div class="text-12-medium text-text-strong truncate">{providerName(item.provider_id)}</div>
                            <div class="text-11-regular text-text-weak truncate">{item.provider_id}</div>
                          </div>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-11-regular text-text-weak">{item.auth_type ?? "no-key"}</span>
                          <span class="text-11-regular text-text-weak">{item.has_config ? "cfg" : "no-cfg"}</span>
                          <span class="text-11-regular text-text-weak">{item.disabled ? "disabled" : "enabled"}</span>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => setState("providerID", item.provider_id)}
                            disabled={state.pending}
                          >
                            更新密钥
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => setState("providerID", item.provider_id)}
                            disabled={state.pending}
                          >
                            编辑配置
                          </Button>
                          <Button type="button" size="small" variant="secondary" onClick={() => void removeProvider(item.provider_id)} disabled={state.pending}>
                            删除
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 flex flex-col gap-2">
              <div class="text-12-medium text-text-weak">新增或更新供应商</div>
              <Show when={providerPopular().length > 0}>
                <div class="flex flex-wrap gap-1.5">
                  <For each={providerPopular()}>
                    {(item) => (
                      <Button
                        type="button"
                        size="small"
                        variant={state.providerID === item.id ? "primary" : "secondary"}
                        onClick={() => setState("providerID", item.id)}
                      >
                        {item.name}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={state.providerID}
                  onChange={(event) => setState("providerID", event.currentTarget.value)}
                >
                  <option value="">请选择供应商</option>
                  <For each={providerAll()}>
                    {(item) => (
                      <option value={item.id}>
                        {item.name} ({item.id})
                      </option>
                    )}
                  </For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="API Key"
                  type="password"
                  value={state.providerKey}
                  onInput={(event) => setState("providerKey", event.currentTarget.value)}
                />
              </div>
              <input
                class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                placeholder="或手动输入供应商ID（自定义供应商）"
                value={state.providerID}
                onInput={(event) => setState("providerID", event.currentTarget.value)}
                list="account-user-provider-catalog"
              />
              <datalist id="account-user-provider-catalog">
                <For each={providerCatalog()}>
                  {(item) => <option value={item.id}>{item.name}</option>}
                </For>
              </datalist>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="默认模型 provider/model"
                  value={state.providerModel}
                  onInput={(event) => setState("providerModel", event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="small_model provider/model"
                  value={state.providerSmallModel}
                  onInput={(event) => setState("providerSmallModel", event.currentTarget.value)}
                />
              </div>
              <textarea
                class="min-h-[140px] rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular font-mono"
                placeholder="Provider Config JSON"
                value={state.providerConfigText}
                onInput={(event) => setState("providerConfigText", event.currentTarget.value)}
              />
              <div class="flex flex-wrap gap-2">
                <Button type="button" size="small" variant="secondary" onClick={() => void saveProviderConfig()} disabled={state.pending || !state.providerID.trim()}>
                  保存供应商配置
                </Button>
                <Button type="button" size="small" variant="secondary" onClick={() => void saveProviderControl()} disabled={state.pending}>
                  保存默认模型配置
                </Button>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeProvider} disabled={state.pending}>
                关闭
              </Button>
              <Button type="submit" disabled={state.pending || !state.providerID.trim() || !state.providerKey.trim()}>
                {state.pending ? "保存中..." : "保存供应商"}
              </Button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  )
}
