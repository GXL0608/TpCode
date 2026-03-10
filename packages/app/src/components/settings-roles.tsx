import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { type AccountPermission, type AccountRole, type AccountUser, permissionZh, roleZh } from "./settings-rbac-zh"

type RoleProductsResponse = {
  ok: boolean
  role_code: string
  product_ids: string[]
}

type ProductItem = {
  id: string
  name: string
  project_id: string
  worktree: string
  vcs?: string
}

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

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

const pageSizes = [10, 20, 50, 100, 500] as const
const builtinRoleSet = new Set(["super_admin", "dev_lead", "developer", "ops", "pm", "value_ops", "hospital_admin", "dept_director", "hospital_user", "dean"])
const hiddenPermissionCodes = new Set([
  "provider:config_global",
  "provider:config_user",
  "provider:config_own",
  "provider:use_own",
  "ui:settings.providers:view",
  "ui:settings.models:view",
])

export const SettingsRoles = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const canRole = createMemo(() => auth.has("role:manage"))
  const canMember = createMemo(() => canRole())

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    createCode: "",
    createName: "",
    createScope: "system" as "system" | "org",
    rolePage: 1,
    roleJump: "1",
    rolePageSize: 20,
    roleTotal: 0,
    roles: [] as AccountRole[],
    permissions: [] as AccountPermission[],
    users: [] as AccountUser[],
    permOpen: false,
    permRoleCode: "",
    permCodes: [] as string[],
    permBase: [] as string[],
    permQuery: "",
    memberOpen: false,
    memberRoleCode: "",
    memberUserIDs: [] as string[],
    memberBase: [] as string[],
    memberLoading: false,
    productOpen: false,
    productRoleCode: "",
    productIDs: [] as string[],
    productBase: [] as string[],
    productCatalog: [] as ProductItem[],
    productCatalogLoading: false,
    productQuery: "",
  })

  const permissionQuickCodes = [
    "agent:use_docs",
    "agent:use_build",
  ] as const
  const permissionQuickSet = new Set<string>(permissionQuickCodes)
  const quickPermissions = createMemo(() =>
    permissionQuickCodes.map((code) => {
      const found = state.permissions.find((item) => item.code === code)
      if (found) return found
      return {
        id: code,
        code,
        name: permissionZh(code),
        group_name: code.startsWith("agent:") ? "agent" : code.startsWith("provider:") ? "provider" : "ui",
      }
    }),
  )
  const filteredPermissions = createMemo(() => {
    const query = state.permQuery.trim().toLowerCase()
    const rows = state.permissions.filter((item) => !permissionQuickSet.has(item.code) && !hiddenPermissionCodes.has(item.code))
    if (!query) return rows
    return rows.filter((item) => {
      const name = permissionZh(item.code).toLowerCase()
      return item.code.toLowerCase().includes(query) || name.includes(query)
    })
  })

  const productCatalogFiltered = createMemo(() => {
    const query = state.productQuery.trim().toLowerCase()
    if (!query) return state.productCatalog
    return state.productCatalog.filter((item) => {
      return item.name.toLowerCase().includes(query) || item.worktree.toLowerCase().includes(query)
    })
  })

  const rolePageTotal = createMemo(() => Math.max(1, Math.ceil(state.roleTotal / state.rolePageSize)))
  const roleRangeStart = createMemo(() => {
    if (state.roleTotal === 0 || state.roles.length === 0) return 0
    return (state.rolePage - 1) * state.rolePageSize + 1
  })
  const roleRangeEnd = createMemo(() => {
    const start = roleRangeStart()
    if (start === 0) return 0
    return start + state.roles.length - 1
  })
  const roleTitle = (code: string) => {
    const role = state.roles.find((item) => item.code === code)
    if (role?.name) return `${role.name} (${role.code})`
    const name = roleZh(code)
    if (name === code) return code
    return `${name} (${code})`
  }

  const togglePerm = (code: string) => {
    if (state.permCodes.includes(code)) {
      setState("permCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("permCodes", (current) => [...current, code])
  }

  const toggleMember = (userID: string) => {
    if (state.memberUserIDs.includes(userID)) {
      setState("memberUserIDs", (current) => current.filter((item) => item !== userID))
      return
    }
    setState("memberUserIDs", (current) => [...current, userID])
  }

  const toggleProduct = (productID: string) => {
    if (state.productIDs.includes(productID)) {
      setState("productIDs", (current) => current.filter((item) => item !== productID))
      return
    }
    setState("productIDs", (current) => [...current, productID])
  }

  const load = async (input?: { page?: number; pageSize?: number }) => {
    if (!canRole()) return
    setState("loading", true)
    setState("error", "")
    const pageID = input?.page ?? state.rolePage
    const pageSize = input?.pageSize ?? state.rolePageSize

    const rolesQuery = new URLSearchParams({
      page: String(pageID),
      page_size: String(pageSize),
    })
    const rolesResponse = await request({ path: `/account/admin/roles?${rolesQuery.toString()}` }).catch(() => undefined)
    const permissionsResponse = await request({ path: "/account/admin/permissions" }).catch(() => undefined)

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

    const rolesBody = await rolesResponse.json().catch(() => undefined)
    const rolesPage = page<AccountRole>(rolesBody)
    const roles = rolesPage ? list<AccountRole>(rolesPage.items) : list<AccountRole>(rolesBody)
    const permissions = list<AccountPermission>(await permissionsResponse.json().catch(() => undefined))

    setState("roles", roles)
    setState("rolePage", Math.max(1, rolesPage?.page ?? pageID))
    setState("roleJump", String(Math.max(1, rolesPage?.page ?? pageID)))
    setState("rolePageSize", Math.max(1, rolesPage?.page_size ?? pageSize))
    setState("roleTotal", Math.max(0, rolesPage?.total ?? roles.length))
    setState("permissions", permissions)
    setState("loading", false)
  }

  const loadRolePage = async () => {
    const next = Number(state.roleJump.trim())
    if (!Number.isFinite(next)) {
      setState("roleJump", String(state.rolePage))
      return
    }
    await load({ page: Math.min(rolePageTotal(), Math.max(1, Math.floor(next))) })
  }

  const loadRolePageSize = async (pageSize: number) => {
    setState("rolePageSize", pageSize)
    setState("roleJump", "1")
    await load({ page: 1, pageSize })
  }

  const loadCatalog = async () => {
    setState("productCatalogLoading", true)
    const response = await request({ path: "/account/admin/products" }).catch(() => undefined)
    setState("productCatalogLoading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const rows = list<ProductItem>(await response.json().catch(() => undefined))
    setState("productCatalog", rows)
  }

  const openPerm = (role: AccountRole) => {
    setState("permOpen", true)
    setState("permRoleCode", role.code)
    setState("permCodes", role.permissions.slice())
    setState("permBase", role.permissions.slice())
    setState("permQuery", "")
  }

  const openMember = async (role: AccountRole) => {
    if (!canMember()) return
    setState("error", "")
    setState("memberOpen", true)
    setState("memberRoleCode", role.code)
    setState("memberUserIDs", [])
    setState("memberBase", [])
    setState("users", [])
    setState("memberLoading", true)
    const response = await request({ path: "/account/admin/users" }).catch(() => undefined)
    setState("memberLoading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const usersBody = await response.json().catch(() => undefined)
    const usersPage = page<AccountUser>(usersBody)
    const users = usersPage ? list<AccountUser>(usersPage.items) : list<AccountUser>(usersBody)
    const selected = users.filter((item) => item.roles.includes(role.code)).map((item) => item.id)
    setState("users", users)
    setState("memberUserIDs", selected)
    setState("memberBase", selected)
  }

  const openProduct = async (role: AccountRole) => {
    setState("productOpen", true)
    setState("productRoleCode", role.code)
    setState("productQuery", "")
    await loadCatalog()
    const response = await request({ path: `/account/admin/roles/${encodeURIComponent(role.code)}/products` }).catch(() => undefined)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      setState("productOpen", false)
      return
    }
    const body = (await response.json().catch(() => undefined)) as RoleProductsResponse | undefined
    const ids = body?.product_ids ?? []
    setState("productIDs", ids)
    setState("productBase", ids)
  }

  const closePerm = () => {
    if (state.pending) return
    setState("permOpen", false)
    setState("permRoleCode", "")
    setState("permCodes", [])
    setState("permBase", [])
    setState("permQuery", "")
  }

  const closeMember = () => {
    if (state.pending) return
    setState("memberOpen", false)
    setState("memberRoleCode", "")
    setState("memberUserIDs", [])
    setState("memberBase", [])
    setState("users", [])
    setState("memberLoading", false)
  }

  const closeProduct = () => {
    if (state.pending) return
    setState("productOpen", false)
    setState("productRoleCode", "")
    setState("productIDs", [])
    setState("productBase", [])
    setState("productQuery", "")
  }

  const savePerm = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.permRoleCode) return
    if (sameSet(state.permCodes, state.permBase)) {
      closePerm()
      return
    }
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "POST",
      path: `/account/admin/roles/${encodeURIComponent(state.permRoleCode)}/permissions`,
      body: { permission_codes: state.permCodes },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "角色权限已更新")
    closePerm()
    await load()
    await auth.reload()
  }

  const saveMember = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.memberRoleCode) return
    if (sameSet(state.memberUserIDs, state.memberBase)) {
      closeMember()
      return
    }

    const updates = state.users
      .map((item) => {
        const before = item.roles.includes(state.memberRoleCode)
        const after = state.memberUserIDs.includes(item.id)
        if (before === after) return
        return {
          id: item.id,
          role_codes: after
            ? [...new Set([...item.roles, state.memberRoleCode])]
            : item.roles.filter((code) => code !== state.memberRoleCode),
        }
      })
      .filter((item): item is { id: string; role_codes: string[] } => !!item)

    setState("pending", true)
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
    setState("pending", false)
    const failed = responses.find((item) => !item?.ok)
    if (failed) {
      setState("error", await parseAccountError(failed))
      return
    }
    setState("message", "角色成员已更新")
    closeMember()
    await load()
  }

  const saveProduct = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.productRoleCode) return
    if (sameSet(state.productIDs, state.productBase)) {
      closeProduct()
      return
    }
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "PUT",
      path: `/account/admin/roles/${encodeURIComponent(state.productRoleCode)}/products`,
      body: { product_ids: state.productIDs },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "角色产品分配已更新")
    closeProduct()
    await load()
  }

  const saveRole = async (event: SubmitEvent) => {
    event.preventDefault()
    const code = state.createCode.trim()
    const name = state.createName.trim()
    if (!code || !name) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "POST",
      path: "/account/admin/roles",
      body: {
        code,
        name,
        scope: state.createScope,
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("createCode", "")
    setState("createName", "")
    setState("createScope", "system")
    setState("message", "角色已创建")
    setState("rolePage", 1)
    await load({ page: 1 })
  }

  const removeRole = async (item: AccountRole) => {
    const ok = globalThis.confirm(
      `确认删除角色「${item.name || item.code}」？\n\n删除后会同时移除该角色的成员绑定、权限配置，以及关联的产品/项目访问关系，且无法恢复。`,
    )
    if (!ok) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "DELETE",
      path: `/account/admin/roles/${encodeURIComponent(item.code)}`,
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", `角色 ${item.name || item.code} 已删除`)
    const page = state.roles.length === 1 && state.rolePage > 1 ? state.rolePage - 1 : state.rolePage
    await auth.reload()
    if (!auth.has("role:manage")) return
    await load({ page })
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
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
              <div class="text-12-regular text-text-weak mt-1">单表格管理角色权限、成员与产品分配</div>
            </div>
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
              刷新
            </Button>
          </div>

          <form class="rounded-xl border border-border-weak-base bg-surface-panel/35 p-3 grid grid-cols-1 md:grid-cols-4 gap-2" onSubmit={saveRole}>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="角色编码（如：feature_owner）"
              value={state.createCode}
              onInput={(event) => setState("createCode", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="角色名称（如：功能负责人）"
              value={state.createName}
              onInput={(event) => setState("createName", event.currentTarget.value)}
            />
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={state.createScope}
              onChange={(event) => setState("createScope", event.currentTarget.value === "org" ? "org" : "system")}
            >
              <option value="system">系统级角色</option>
              <option value="org">组织级角色</option>
            </select>
            <Button type="submit" disabled={state.pending || !state.createCode.trim() || !state.createName.trim()}>
              {state.pending ? "提交中..." : "新增角色"}
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
              <span>角色列表</span>
              <Show when={state.loading}>
                <span class="text-12-regular text-text-weak">加载中...</span>
              </Show>
            </div>
            <div class="max-h-[620px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">角色编码</th>
                    <th class="text-left px-3 py-2">角色名称</th>
                    <th class="w-16 text-center px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.roles}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base hover:bg-surface-panel/45 transition-colors">
                        <td class="px-3 py-2 text-12-medium text-text-strong">{item.code}</td>
                        <td class="px-3 py-2 text-text-weak">{item.name || roleZh(item.code)}</td>
                        <td class="px-3 py-2">
                          <div class="flex justify-center">
                            <DropdownMenu gutter={4} placement="bottom-end">
                              <DropdownMenu.Trigger
                                as={IconButton}
                                icon="dot-grid"
                                variant="ghost"
                                class="size-7 rounded-md data-[expanded]:bg-surface-base-active"
                                aria-label={`管理角色 ${item.code}`}
                              />
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content>
                                  <DropdownMenu.Item onSelect={() => openPerm(item)}>
                                    <DropdownMenu.ItemLabel>权限设置</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <Show when={canMember()}>
                                    <DropdownMenu.Item onSelect={() => void openMember(item)}>
                                      <DropdownMenu.ItemLabel>成员管理</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                  </Show>
                                  <DropdownMenu.Item onSelect={() => void openProduct(item)}>
                                    <DropdownMenu.ItemLabel>分配产品</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item
                                    onSelect={() => void removeRole(item)}
                                    disabled={state.pending || builtinRoleSet.has(item.code)}
                                  >
                                    <DropdownMenu.ItemLabel>删除角色</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.roles.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={3}>
                        暂无角色数据
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
            <div class="px-4 py-3 border-t border-border-weak-base bg-surface-panel/35 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div class="text-12-regular text-text-weak">
                第 {state.rolePage} / {rolePageTotal()} 页，共 {state.roleTotal} 条（当前 {roleRangeStart()}-{roleRangeEnd()}）
              </div>
              <div class="flex flex-col gap-2 md:flex-row md:items-center">
                <div class="flex items-center gap-2">
                  <span class="text-12-regular text-text-weak">每页</span>
                  <select
                    class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular"
                    value={String(state.rolePageSize)}
                    onChange={(event) => void loadRolePageSize(Number(event.currentTarget.value))}
                  >
                    <For each={pageSizes}>{(item) => <option value={item}>{item}</option>}</For>
                  </select>
                  <span class="text-12-regular text-text-weak">条</span>
                </div>
                <form
                  class="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void loadRolePage()
                  }}
                >
                  <span class="text-12-regular text-text-weak">跳到</span>
                  <input
                    class="h-8 w-20 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular"
                    inputMode="numeric"
                    value={state.roleJump}
                    onInput={(event) => setState("roleJump", event.currentTarget.value)}
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
                  disabled={state.loading || state.rolePage <= 1}
                  onClick={() => void load({ page: state.rolePage - 1 })}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={state.loading || state.rolePage >= rolePageTotal()}
                  onClick={() => void load({ page: state.rolePage + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Show>

      <Show when={state.permOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={savePerm}>
            <div class="text-16-medium text-text-strong">权限设置 · {roleTitle(state.permRoleCode)}</div>
            <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">设置页可见性、用户供应商与智能体可用性</div>
              <For each={quickPermissions()}>
                {(item) => (
                  <label class="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-base/80">
                    <input type="checkbox" checked={state.permCodes.includes(item.code)} onChange={() => togglePerm(item.code)} />
                    <span class="text-12-regular text-text-strong">{permissionZh(item.code)}</span>
                    <span class="text-11-regular text-text-weak">{item.code}</span>
                  </label>
                )}
              </For>
            </div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="搜索权限编码或名称"
              value={state.permQuery}
              onInput={(event) => setState("permQuery", event.currentTarget.value)}
            />
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <For each={filteredPermissions()}>
                {(item) => (
                  <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                    <input type="checkbox" checked={state.permCodes.includes(item.code)} onChange={() => togglePerm(item.code)} />
                    <span class="text-12-regular text-text-strong">{permissionZh(item.code)}</span>
                    <span class="text-11-regular text-text-weak">{item.code}</span>
                  </label>
                )}
              </For>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closePerm} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.memberOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveMember}>
            <div class="text-16-medium text-text-strong">成员管理 · {roleTitle(state.memberRoleCode)}</div>
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.memberLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载成员中...</div>}>
                <For each={state.users}>
                  {(item) => (
                    <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                      <input type="checkbox" checked={state.memberUserIDs.includes(item.id)} onChange={() => toggleMember(item.id)} />
                      <span class="text-12-regular text-text-strong">{item.display_name}</span>
                      <span class="text-11-regular text-text-weak">({item.username})</span>
                    </label>
                  )}
                </For>
                <Show when={state.users.length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">暂无可选成员</div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeMember} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.productOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-3xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveProduct}>
            <div class="text-16-medium text-text-strong">分配产品 · {roleTitle(state.productRoleCode)}</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="搜索产品名称/目录"
              value={state.productQuery}
              onInput={(event) => setState("productQuery", event.currentTarget.value)}
            />
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.productCatalogLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载产品中...</div>}>
                <For each={productCatalogFiltered()}>
                  {(item) => (
                    <label class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                      <input type="checkbox" checked={state.productIDs.includes(item.id)} onChange={() => toggleProduct(item.id)} />
                      <div class="min-w-0">
                        <div class="text-12-medium text-text-strong">{item.name}</div>
                        <div class="text-11-regular text-text-weak break-all">{item.worktree}</div>
                      </div>
                    </label>
                  )}
                </For>
                <Show when={productCatalogFiltered().length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">暂无可分配产品，请先到项目管理里维护产品。</div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeProduct} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  )
}
