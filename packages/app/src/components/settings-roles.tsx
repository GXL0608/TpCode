import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { type AccountPermission, type AccountRole, type AccountUser, permissionZh, roleZh } from "./settings-rbac-zh"

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function groupZh(code: string) {
  if (code === "system") return "系统管理"
  if (code === "session") return "会话管理"
  if (code === "code") return "代码生成"
  if (code === "prototype") return "原型流程"
  if (code === "file") return "文件操作"
  if (code === "provider") return "模型配置"
  if (code === "audit") return "审计日志"
  return code
}

export const SettingsRoles = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const canRole = createMemo(() => auth.has("role:manage"))
  const canUser = createMemo(() => auth.has("user:manage"))

  const [state, setState] = createStore({
    loading: false,
    permissionSaving: false,
    userSaving: false,
    error: "",
    message: "",
    roles: [] as AccountRole[],
    permissions: [] as AccountPermission[],
    users: [] as AccountUser[],
    currentRole: "",
    roleQuery: "",
    permissionQuery: "",
    userQuery: "",
    permissionCodes: [] as string[],
    permissionBase: [] as string[],
    userIDs: [] as string[],
    userBase: [] as string[],
  })

  const selectedRole = createMemo(() => state.roles.find((item) => item.code === state.currentRole))
  const roleCount = createMemo(() => {
    const out = new Map<string, number>()
    for (const role of state.roles) out.set(role.code, 0)
    for (const user of state.users) {
      for (const role of user.roles) out.set(role, (out.get(role) ?? 0) + 1)
    }
    return out
  })

  const roleList = createMemo(() => {
    const query = state.roleQuery.trim().toLowerCase()
    if (!query) return state.roles
    return state.roles.filter((item) => {
      const name = roleZh(item.code).toLowerCase()
      return item.code.toLowerCase().includes(query) || name.includes(query)
    })
  })

  const permissionGroups = createMemo(() => {
    const query = state.permissionQuery.trim().toLowerCase()
    const filtered = state.permissions.filter((item) => {
      if (!query) return true
      return (
        item.code.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        permissionZh(item.code).toLowerCase().includes(query)
      )
    })
    const out = new Map<string, AccountPermission[]>()
    for (const item of filtered) {
      const group = item.group_name || "other"
      const current = out.get(group)
      if (current) {
        current.push(item)
        continue
      }
      out.set(group, [item])
    }
    return [...out.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([group, items]) => ({
        group,
        items: items.sort((a, b) => a.code.localeCompare(b.code)),
      }))
  })

  const visiblePermissionCodes = createMemo(() =>
    permissionGroups().flatMap((group) => group.items.map((item) => item.code)),
  )

  const userList = createMemo(() => {
    const query = state.userQuery.trim().toLowerCase()
    if (!query) return state.users
    return state.users.filter((item) => {
      const username = item.username.toLowerCase()
      const display = (item.display_name ?? "").toLowerCase()
      return username.includes(query) || display.includes(query)
    })
  })

  const permissionDirty = createMemo(() => !sameSet(state.permissionCodes, state.permissionBase))
  const userDirty = createMemo(() => !sameSet(state.userIDs, state.userBase))

  const syncSelection = (code?: string, roles = state.roles, users = state.users) => {
    const role = roles.find((item) => item.code === (code ?? state.currentRole)) ?? roles[0]
    if (!role) {
      setState("currentRole", "")
      setState("permissionCodes", [])
      setState("permissionBase", [])
      setState("userIDs", [])
      setState("userBase", [])
      return
    }
    const userIDs = users.filter((item) => item.roles.includes(role.code)).map((item) => item.id)
    const permissionCodes = role.permissions.slice()
    setState("currentRole", role.code)
    setState("permissionCodes", permissionCodes)
    setState("permissionBase", permissionCodes)
    setState("userIDs", userIDs)
    setState("userBase", userIDs)
  }

  const togglePermission = (code: string) => {
    if (state.permissionCodes.includes(code)) {
      setState("permissionCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("permissionCodes", (current) => [...current, code])
  }

  const toggleUser = (id: string) => {
    if (state.userIDs.includes(id)) {
      setState("userIDs", (current) => current.filter((item) => item !== id))
      return
    }
    setState("userIDs", (current) => [...current, id])
  }

  const selectVisiblePermissions = () => {
    const visible = visiblePermissionCodes()
    setState("permissionCodes", (current) => [...new Set([...current, ...visible])])
  }

  const clearVisiblePermissions = () => {
    const visible = new Set(visiblePermissionCodes())
    setState("permissionCodes", (current) => current.filter((item) => !visible.has(item)))
  }

  const load = async () => {
    if (!canRole()) return
    setState("loading", true)
    setState("error", "")

    const rolesResponse = await request({ path: "/account/admin/roles" }).catch(() => undefined)
    const permissionsResponse = await request({ path: "/account/admin/permissions" }).catch(() => undefined)
    const usersResponse = canUser() ? await request({ path: "/account/admin/users" }).catch(() => undefined) : undefined

    if (!rolesResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(rolesResponse))
      return
    }
    if (!permissionsResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(permissionsResponse))
      return
    }

    const roles = list<AccountRole>(await rolesResponse.json().catch(() => undefined))
    const permissions = list<AccountPermission>(await permissionsResponse.json().catch(() => undefined))
    const users = usersResponse?.ok ? list<AccountUser>(await usersResponse.json().catch(() => undefined)) : []

    setState("roles", roles)
    setState("permissions", permissions)
    setState("users", users)
    syncSelection(state.currentRole, roles, users)
    setState("loading", false)
  }

  const savePermissions = async () => {
    if (!canRole()) return
    if (!state.currentRole) return
    if (!permissionDirty()) return

    setState("permissionSaving", true)
    setState("message", "")
    setState("error", "")

    const response = await request({
      method: "POST",
      path: `/account/admin/roles/${encodeURIComponent(state.currentRole)}/permissions`,
      body: { permission_codes: state.permissionCodes },
    }).catch(() => undefined)

    setState("permissionSaving", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }

    setState("message", "角色权限已更新")
    await load()
  }

  const saveRoleUsers = async () => {
    if (!canRole() || !canUser()) return
    if (!state.currentRole) return
    if (!userDirty()) return

    const updates = state.users
      .map((item) => {
        const before = item.roles.includes(state.currentRole)
        const after = state.userIDs.includes(item.id)
        if (before === after) return
        return {
          id: item.id,
          role_codes: after
            ? [...new Set([...item.roles, state.currentRole])]
            : item.roles.filter((code) => code !== state.currentRole),
        }
      })
      .filter((item): item is { id: string; role_codes: string[] } => !!item)

    if (updates.length === 0) {
      setState("message", "角色成员没有变化")
      return
    }

    setState("userSaving", true)
    setState("message", "")
    setState("error", "")

    const responses = await Promise.all(
      updates.map((item) =>
        request({
          method: "POST",
          path: `/account/admin/users/${encodeURIComponent(item.id)}/roles`,
          body: { role_codes: item.role_codes },
        }).catch(() => undefined),
      ),
    )

    const failed = responses.find((item) => !item?.ok)
    setState("userSaving", false)

    if (failed) {
      setState("error", await parseAccountError(failed))
      return
    }

    setState("message", "角色成员已更新")
    await load()
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  createEffect(() => {
    if (!state.currentRole) return
    const role = state.roles.find((item) => item.code === state.currentRole)
    if (!role) return
    const permissionCodes = role.permissions.slice()
    const userIDs = state.users.filter((item) => item.roles.includes(role.code)).map((item) => item.id)
    setState("permissionCodes", permissionCodes)
    setState("permissionBase", permissionCodes)
    setState("userIDs", userIDs)
    setState("userBase", userIDs)
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canRole()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有角色管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-18-medium text-text-strong">角色管理</div>
              <div class="text-12-regular text-text-weak mt-1">RBAC：管理角色权限并分配角色成员</div>
            </div>
            <div class="flex items-center gap-2">
              <Show when={state.loading}>
                <span class="rounded-full bg-surface-panel px-3 py-1 text-11-medium text-text-weak">加载中...</span>
              </Show>
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
                刷新
              </Button>
            </div>
          </div>

          <Show when={state.message}>
            <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
          </Show>
          <Show when={state.error}>
            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
          </Show>

          <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div class="rounded-xl border border-border-weak-base bg-surface-base p-3 flex flex-col gap-2 max-h-[560px] overflow-auto">
              <div class="text-12-medium text-text-weak px-1">角色列表</div>
              <input
                class="h-9 rounded-md border border-border-weak-base bg-background-base px-3 text-13-regular"
                placeholder="搜索角色"
                value={state.roleQuery}
                onInput={(event) => setState("roleQuery", event.currentTarget.value)}
              />
              <For each={roleList()}>
                {(item) => (
                  <button
                    type="button"
                    class="w-full text-left rounded-lg border px-3 py-2 transition-colors"
                    classList={{
                      "border-border-strong-base bg-surface-panel": state.currentRole === item.code,
                      "border-border-weak-base bg-surface-base hover:bg-surface-panel/45": state.currentRole !== item.code,
                    }}
                    onClick={() => setState("currentRole", item.code)}
                  >
                    <div class="text-13-medium text-text-strong">{roleZh(item.code)}</div>
                    <div class="text-11-regular text-text-weak mt-1">
                      {item.permissions.length} 项权限 · {roleCount().get(item.code) ?? 0} 名成员
                    </div>
                  </button>
                )}
              </For>
            </div>

            <div class="xl:col-span-2 flex flex-col gap-4">
              <Show
                when={selectedRole()}
                fallback={
                  <div class="rounded-xl border border-border-weak-base bg-surface-base p-4 text-13-regular text-text-weak">
                    暂无角色数据
                  </div>
                }
              >
                <section class="rounded-xl border border-border-weak-base bg-surface-base p-4 flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div class="text-14-medium text-text-strong">角色权限</div>
                      <div class="text-12-regular text-text-weak mt-1">当前角色：{roleZh(selectedRole()?.code)}</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Show when={permissionDirty()}>
                        <span class="rounded-full border border-border-weak-base bg-surface-panel px-3 py-1 text-11-medium text-text-weak">
                          有未保存变更
                        </span>
                      </Show>
                      <Button type="button" onClick={savePermissions} disabled={state.permissionSaving || !permissionDirty()}>
                        {state.permissionSaving ? "保存中..." : "保存权限"}
                      </Button>
                    </div>
                  </div>

                  <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <input
                        class="h-9 flex-1 rounded-md border border-border-weak-base bg-background-base px-3 text-13-regular"
                        placeholder="搜索权限"
                        value={state.permissionQuery}
                        onInput={(event) => setState("permissionQuery", event.currentTarget.value)}
                      />
                      <Button type="button" variant="secondary" size="small" onClick={selectVisiblePermissions}>
                        全选可见
                      </Button>
                      <Button type="button" variant="secondary" size="small" onClick={clearVisiblePermissions}>
                        清空可见
                      </Button>
                    </div>

                    <div class="flex flex-col gap-3 max-h-[300px] overflow-auto">
                      <For each={permissionGroups()}>
                        {(group) => (
                          <div class="rounded-md border border-border-weak-base bg-surface-base p-3">
                            <div class="text-12-medium text-text-weak mb-2">{groupZh(group.group)}</div>
                            <div class="flex flex-wrap gap-2">
                              <For each={group.items}>
                                {(permission) => (
                                  <label class="inline-flex items-center gap-2 rounded-full border border-border-weak-base bg-surface-panel px-3 py-1.5 text-12-regular">
                                    <input
                                      type="checkbox"
                                      checked={state.permissionCodes.includes(permission.code)}
                                      onChange={() => togglePermission(permission.code)}
                                    />
                                    <span>{permissionZh(permission.code)}</span>
                                  </label>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </section>

                <section class="rounded-xl border border-border-weak-base bg-surface-base p-4 flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div class="text-14-medium text-text-strong">角色成员</div>
                      <div class="text-12-regular text-text-weak mt-1">为当前角色分配用户</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Show when={userDirty()}>
                        <span class="rounded-full border border-border-weak-base bg-surface-panel px-3 py-1 text-11-medium text-text-weak">
                          有未保存变更
                        </span>
                      </Show>
                      <Button type="button" onClick={saveRoleUsers} disabled={state.userSaving || !canUser() || !userDirty()}>
                        {state.userSaving ? "保存中..." : "保存成员"}
                      </Button>
                    </div>
                  </div>

                  <Show
                    when={canUser()}
                    fallback={<div class="text-12-regular text-text-weak">当前账号没有用户读取权限，无法分配角色成员</div>}
                  >
                    <input
                      class="h-9 rounded-md border border-border-weak-base bg-background-base px-3 text-13-regular"
                      placeholder="搜索用户"
                      value={state.userQuery}
                      onInput={(event) => setState("userQuery", event.currentTarget.value)}
                    />
                    <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 flex flex-col gap-2 max-h-[260px] overflow-auto">
                      <For each={userList()}>
                        {(item) => (
                          <label class="flex items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base px-3 py-2">
                            <div>
                              <div class="text-13-medium text-text-strong">{item.display_name || item.username}</div>
                              <div class="text-11-regular text-text-weak mt-0.5">{item.username}</div>
                            </div>
                            <input type="checkbox" checked={state.userIDs.includes(item.id)} onChange={() => toggleUser(item.id)} />
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </Show>
            </div>
          </div>

          <section class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong">角色权限总览</div>
            <div class="max-h-[320px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">角色</th>
                    <th class="text-left px-3 py-2">权限</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.roles}>
                    {(role) => (
                      <tr class="border-t border-border-weak-base">
                        <td class="px-3 py-2">{roleZh(role.code)}</td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-1.5">
                            <For each={role.permissions.length > 0 ? role.permissions : ["-"]}>
                              {(permission) => (
                                <span class="rounded-full border border-border-weak-base bg-surface-panel px-2.5 py-0.5 text-11-medium text-text-weak">
                                  {permissionZh(permission)}
                                </span>
                              )}
                            </For>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </Show>
    </div>
  )
}
